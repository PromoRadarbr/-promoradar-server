const express = require("express");

const app = express();

app.use(express.json());

let accessToken = null;
let refreshToken = null;


// =====================================================
// INÍCIO
// =====================================================

app.get("/", (req, res) => {
  res.send("PromoRadar online!");
});


// =====================================================
// AUTORIZAÇÃO MERCADO LIVRE
// =====================================================

app.get("/auth", (req, res) => {
  const clientId = process.env.ML_CLIENT_ID;
  const redirectUri = process.env.ML_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).send(
      "ML_CLIENT_ID ou ML_REDIRECT_URI não configurado no Render."
    );
  }

  const authUrl =
    "https://auth.mercadolivre.com.br/authorization" +
    "?response_type=code" +
    `&client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  res.redirect(authUrl);
});


// =====================================================
// CALLBACK DA AUTORIZAÇÃO
// =====================================================

app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send(
      "Código de autorização não recebido."
    );
  }

  try {
    const response = await fetch(
      "https://api.mercadolibre.com/oauth/token",
      {
        method: "POST",

        headers: {
          accept: "application/json",
          "content-type":
            "application/x-www-form-urlencoded"
        },

        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: process.env.ML_CLIENT_ID,
          client_secret: process.env.ML_CLIENT_SECRET,
          code: code,
          redirect_uri: process.env.ML_REDIRECT_URI
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("ERRO OAUTH:", data);

      return res
        .status(response.status)
        .json(data);
    }

    accessToken = data.access_token;
    refreshToken = data.refresh_token || null;

    console.log(
      "Mercado Livre conectado. Usuário:",
      data.user_id
    );

    res.send(`
      <html>
        <head>
          <meta charset="UTF-8">
          <title>PromoRadar</title>
        </head>

        <body>
          <h1>PromoRadar conectado!</h1>
          <p>Autorização realizada com sucesso.</p>
          <p>Usuário Mercado Livre: ${data.user_id}</p>
          <p>Agora você pode testar a conexão.</p>
        </body>
      </html>
    `);

  } catch (error) {
    console.error("ERRO OAUTH:", error);

    res
      .status(500)
      .send(
        "Erro interno ao conectar com o Mercado Livre."
      );
  }
});


// =====================================================
// TESTAR AUTORIZAÇÃO
// =====================================================

app.get("/test-ml", async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({
      conectado: false,
      mensagem:
        "PromoRadar ainda não está autorizado."
    });
  }

  try {
    const response = await fetch(
      "https://api.mercadolibre.com/users/me",
      {
        headers: {
          Authorization:
            `Bearer ${accessToken}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(
        "ERRO USERS/ME:",
        response.status,
        data
      );

      return res
        .status(response.status)
        .json(data);
    }

    res.json({
      conectado: true,
      usuario: data.nickname || null,
      id: data.id || null,
      pais: data.country_id || null
    });

  } catch (error) {
    console.error(
      "ERRO /test-ml:",
      error
    );

    res
      .status(500)
      .json({
        conectado: false,
        erro: "Erro ao consultar o Mercado Livre."
      });
  }
});


// =====================================================
// BUSCAR PRODUTOS
// =====================================================

app.get("/buscar", async (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({
      erro:
        "Informe o produto. Exemplo: /buscar?q=iphone"
    });
  }

  try {
    const url =
      "https://api.mercadolibre.com/sites/MLB/search" +
      `?q=${encodeURIComponent(q)}` +
      "&limit=20";

    console.log("BUSCAR URL:", url);

    // IMPORTANTE:
    // A busca geral não precisa do access token.
    const response = await fetch(url);

    const data = await response.json();

    console.log(
      "BUSCAR STATUS:",
      response.status
    );

    if (!response.ok) {
      console.error(
        "ERRO BUSCAR:",
        data
      );

      return res
        .status(response.status)
        .json(data);
    }

    const produtos =
      (data.results || []).map((item) => ({
        item_id:
          item.id || null,

        titulo:
          item.title || null,

        preco:
          item.price ?? null,

        preco_original:
          item.original_price ?? null,

        moeda:
          item.currency_id || null,

        imagem:
          item.thumbnail || null,

        link:
          item.permalink || null,

        vendedor:
          item.seller?.id || null,

        condicao:
          item.condition || null
      }));

    res.json({
      busca: q,

      produtos_encontrados:
        produtos.length,

      total:
        data.paging?.total || 0,

      produtos
    });

  } catch (error) {
    console.error(
      "ERRO /buscar:",
      error
    );

    res.status(500).json({
      erro:
        "Erro ao buscar produtos no Mercado Livre."
    });
  }
});


// =====================================================
// BUSCAR OFERTAS
// =====================================================

app.get("/ofertas", async (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({
      erro:
        "Informe o produto. Exemplo: /ofertas?q=iphone"
    });
  }

  try {
    const url =
      "https://api.mercadolibre.com/sites/MLB/search" +
      `?q=${encodeURIComponent(q)}` +
      "&limit=50";

    console.log(
      "OFERTAS URL:",
      url
    );

    // =================================================
    // NÃO USAMOS ACCESS TOKEN AQUI.
    // A busca pública do Mercado Livre já retorna
    // os anúncios encontrados.
    // =================================================

    const response = await fetch(url);

    const data = await response.json();

    console.log(
      "OFERTAS STATUS:",
      response.status
    );

    if (!response.ok) {
      console.error(
        "ERRO NA BUSCA DE OFERTAS:",
        data
      );

      return res
        .status(response.status)
        .json(data);
    }

    const ofertas = [];

    for (const item of data.results || []) {

      const preco =
        item.price ?? null;

      const precoOriginal =
        item.original_price ?? null;

      let desconto = 0;

      if (
        precoOriginal !== null &&
        preco !== null &&
        precoOriginal > preco
      ) {
        desconto = Math.round(
          (
            (precoOriginal - preco) /
            precoOriginal
          ) * 100
        );
      }

      // Só consideramos como OFERTA aquilo que
      // possui preço original maior que o atual.
      if (desconto <= 0) {
        continue;
      }

      ofertas.push({
        item_id:
          item.id || null,

        titulo:
          item.title || null,

        preco:
          preco,

        preco_original:
          precoOriginal,

        desconto:
          desconto,

        moeda:
          item.currency_id || null,

        imagem:
          item.thumbnail || null,

        link:
          item.permalink || null,

        vendedor:
          item.seller?.id || null,

        condicao:
          item.condition || null
      });
    }


    // =================================================
    // MELHORES DESCONTOS PRIMEIRO
    // =================================================

    ofertas.sort(
      (a, b) =>
        b.desconto - a.desconto
    );


    // =================================================
    // REMOVE DUPLICADOS
    // =================================================

    const ofertasUnicas =
      Array.from(
        new Map(
          ofertas.map((oferta) => [
            oferta.item_id,
            oferta
          ])
        ).values()
      );


    res.json({
      busca: q,

      produtos_encontrados:
        data.results?.length || 0,

      ofertas_encontradas:
        ofertasUnicas.length,

      ofertas:
        ofertasUnicas
    });

  } catch (error) {
    console.error(
      "ERRO /ofertas:",
      error
    );

    res.status(500).json({
      erro:
        "Erro ao buscar ofertas no Mercado Livre."
    });
  }
});


// =====================================================
// NOTIFICAÇÕES MERCADO LIVRE
// =====================================================

app.post("/notifications", (req, res) => {

  console.log(
    "NOTIFICAÇÃO RECEBIDA:",
    req.body
  );

  res.sendStatus(200);
});


// =====================================================
// STATUS DO PROMORADAR
// =====================================================

app.get("/status", (req, res) => {
  res.json({
    online: true,
    mercado_livre_autorizado:
      !!accessToken,
    servidor: "PromoRadar"
  });
});


// =====================================================
// SERVIDOR
// =====================================================

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `Servidor PromoRadar rodando na porta ${PORT}`
  );
});
