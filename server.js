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
      "ML_CLIENT_ID ou ML_REDIRECT_URI não configurado."
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
// CALLBACK
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

        <body style="font-family: Arial; padding: 30px;">
          <h1>PromoRadar conectado!</h1>

          <p>Autorização realizada com sucesso.</p>

          <p>
            Usuário Mercado Livre:
            <strong>${data.user_id}</strong>
          </p>
        </body>
      </html>
    `);

  } catch (error) {
    console.error("ERRO OAUTH:", error);

    res.status(500).send(
      "Erro interno ao conectar com o Mercado Livre."
    );
  }
});


// =====================================================
// TESTAR CONEXÃO
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
      return res
        .status(response.status)
        .json(data);
    }

    res.json({
      conectado: true,
      usuario:
        data.nickname || null,
      id:
        data.id || null,
      pais:
        data.country_id || null
    });

  } catch (error) {

    console.error(
      "ERRO /test-ml:",
      error
    );

    res.status(500).json({
      conectado: false,
      erro:
        "Erro ao consultar o Mercado Livre."
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

  if (!accessToken) {
    return res.status(401).json({
      erro:
        "PromoRadar ainda não está autorizado."
    });
  }

  try {

    const url =
      "https://api.mercadolibre.com/products/search" +
      "?status=active" +
      "&site_id=MLB" +
      `&q=${encodeURIComponent(q)}` +
      "&limit=20";

    const response = await fetch(
      url,
      {
        headers: {
          Authorization:
            `Bearer ${accessToken}`
        }
      }
    );

    const data =
      await response.json();

    if (!response.ok) {
      return res
        .status(response.status)
        .json(data);
    }

    const produtos =
      (data.results || []).map(
        (item) => ({
          product_id:
            item.id || null,

          titulo:
            item.name || null,

          imagem:
            item.pictures?.[0]?.url ||
            null
        })
      );

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

  if (!accessToken) {
    return res.status(401).json({
      erro:
        "PromoRadar ainda não está autorizado."
    });
  }

  try {

    // -------------------------------------------------
    // 1. BUSCAR PRODUTOS DO CATÁLOGO
    // -------------------------------------------------

    const searchUrl =
      "https://api.mercadolibre.com/products/search" +
      "?status=active" +
      "&site_id=MLB" +
      `&q=${encodeURIComponent(q)}` +
      "&limit=20";

    console.log(
      "BUSCA PRODUTOS:",
      searchUrl
    );

    const searchResponse =
      await fetch(
        searchUrl,
        {
          headers: {
            Authorization:
              `Bearer ${accessToken}`
          }
        }
      );

    const searchData =
      await searchResponse.json();

    console.log(
      "STATUS PRODUCTS/SEARCH:",
      searchResponse.status
    );

    if (!searchResponse.ok) {
      return res
        .status(searchResponse.status)
        .json(searchData);
    }


    // -------------------------------------------------
    // 2. BUSCAR SOMENTE PRODUTOS COM DESCONTO
    // -------------------------------------------------

    const ofertas = [];

    for (
      const produto
      of searchData.results || []
    ) {

      try {

        const itemsUrl =
          `https://api.mercadolibre.com/products/${produto.id}/items` +
          "?discount=10-100" +
          "&limit=20";

        const itemsResponse =
          await fetch(
            itemsUrl,
            {
              headers: {
                Authorization:
                  `Bearer ${accessToken}`
              }
            }
          );

        const itemsData =
          await itemsResponse.json();

        console.log(
          "PRODUTO:",
          produto.id,
          "STATUS:",
          itemsResponse.status,
          "OFERTAS:",
          itemsData.results?.length || 0
        );

        if (!itemsResponse.ok) {
          console.error(
            "ERRO NO PRODUTO:",
            produto.id,
            itemsData
          );

          continue;
        }


        // -------------------------------------------------
        // 3. TRANSFORMAR PUBLICAÇÕES EM OFERTAS
        // -------------------------------------------------

        for (
          const item
          of itemsData.results || []
        ) {

          ofertas.push({

            product_id:
              produto.id,

            item_id:
              item.item_id || null,

            titulo:
              produto.name || null,

            preco:
              item.price ?? null,

            moeda:
              item.currency_id || null,

            desconto_minimo:
              10,

            imagem:
              produto.pictures?.[0]?.url ||
              null,

            vendedor:
              item.seller_id || null,

            condicao:
              item.condition || null

          });
        }

      } catch (error) {

        console.error(
          "ERRO AO CONSULTAR PRODUTO:",
          produto.id,
          error
        );
      }
    }


    // -------------------------------------------------
    // 4. REMOVER DUPLICADOS
    // -------------------------------------------------

    const ofertasUnicas =
      Array.from(
        new Map(
          ofertas
            .filter(
              (oferta) =>
                oferta.item_id
            )
            .map(
              (oferta) => [
                oferta.item_id,
                oferta
              ]
            )
        ).values()
      );


    // -------------------------------------------------
    // 5. RESPOSTA
    // -------------------------------------------------

    res.json({

      busca:
        q,

      produtos_encontrados:
        searchData.results?.length || 0,

      ofertas_encontradas:
        ofertasUnicas.length,

      ofertas:
        ofertasUnicas

    });

  } catch (error) {

    console.error(
      "ERRO GERAL /ofertas:",
      error
    );

    res.status(500).json({
      erro:
        "Erro ao buscar ofertas no Mercado Livre."
    });
  }
});
app.get("/teste-produto", async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({
      erro: "PromoRadar ainda não está autorizado."
    });
  }

  try {
    const response = await fetch(
      "https://api.mercadolibre.com/products/MLB47227416/items?limit=20",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const data = await response.json();

    res.status(response.status).json(data);

  } catch (error) {
    console.error("ERRO /teste-produto:", error);

    res.status(500).json({
      erro: error.message
    });
  }
});
app.get("/teste-promocao", async (req, res) => {
  const itemId = req.query.id;

  if (!itemId) {
    return res.status(400).json({
      erro: "Informe o item. Exemplo: /teste-promocao?id=MLB5008947313"
    });
  }

  if (!accessToken) {
    return res.status(401).json({
      erro: "PromoRadar ainda não está autorizado."
    });
  }

  try {
    const response = await fetch(
      `https://api.mercadolibre.com/seller-promotions/items/${itemId}?app_version=v2`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const data = await response.json();

    res.status(response.status).json(data);

  } catch (error) {
    console.error("ERRO /teste-promocao:", error);

    res.status(500).json({
      erro: error.message
    });
  }
});
// =====================================================
// NOTIFICAÇÕES
// =====================================================

app.post("/notifications", (req, res) => {

  console.log(
    "NOTIFICAÇÃO RECEBIDA:",
    req.body
  );

  res.sendStatus(200);
});


// =====================================================
// STATUS
// =====================================================

app.get("/status", (req, res) => {

  res.json({
    online: true,

    mercado_livre_autorizado:
      !!accessToken,

    servidor:
      "PromoRadar"
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
