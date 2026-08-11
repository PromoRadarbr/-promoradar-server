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
      return res.status(response.status).json(data);
    }

    accessToken = data.access_token;
    refreshToken = data.refresh_token || null;

    console.log(
      "Mercado Livre conectado. Usuário:",
      data.user_id
    );

    res.send(`
      <h1>PromoRadar conectado!</h1>
      <p>Autorização realizada com sucesso.</p>
      <p>Usuário: ${data.user_id}</p>
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
      usuario: data.nickname || null,
      id: data.id || null,
      pais: data.country_id || null
    });

  } catch (error) {
    console.error("ERRO /test-ml:", error);

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

    const response = await fetch(url, {
      headers: {
        Authorization:
          `Bearer ${accessToken}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res
        .status(response.status)
        .json(data);
    }

    const produtos =
      (data.results || []).map((produto) => ({
        product_id:
          produto.id || null,

        titulo:
          produto.name || null,

        imagem:
          produto.pictures?.[0]?.url || null
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
    console.error("ERRO /buscar:", error);

    res.status(500).json({
      erro:
        "Erro ao buscar produtos."
    });
  }
});


// =====================================================
// BUSCAR OFERTAS / MELHORES PREÇOS
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
    // 1. ENCONTRAR PRODUTOS DE CATÁLOGO
    // -------------------------------------------------

    const domainResponse = await fetch(
  "https://api.mercadolibre.com/sites/MLB/domain_discovery/search" +
  `?q=${encodeURIComponent(q)}`,
  {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  }
);

const domains = await domainResponse.json();

const domainId =
  domains?.[0]?.domain_id || null;

const searchUrl =
  "https://api.mercadolibre.com/products/search" +
  "?status=active" +
  "&site_id=MLB" +
  `&q=${encodeURIComponent(q)}` +
  (domainId
    ? `&domain_id=${encodeURIComponent(domainId)}`
    : "") +
  "&limit=50";

    const searchResponse =
      await fetch(searchUrl, {
        headers: {
          Authorization:
            `Bearer ${accessToken}`
        }
      });

    const searchData =
      await searchResponse.json();

    if (!searchResponse.ok) {
      return res
        .status(searchResponse.status)
        .json(searchData);
    }

    const ofertas = [];

    // -------------------------------------------------
    // 2. BUSCAR VENDEDORES CONCORRENTES
    // -------------------------------------------------

    for (
      const produto
      of searchData.results || []
    ) {

      try {

        const itemsUrl =
          `https://api.mercadolibre.com/products/${produto.id}/items?limit=50`;

        const itemsResponse =
          await fetch(itemsUrl, {
            headers: {
              Authorization:
                `Bearer ${accessToken}`
            }
          });

        const itemsData =
          await itemsResponse.json();

        if (!itemsResponse.ok) {
          console.error(
            "Erro ao consultar concorrentes:",
            produto.id,
            itemsData
          );

          continue;
        }

        // -------------------------------------------------
        // 3. ADICIONAR PUBLICAÇÕES
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
link:
  item.item_id
    ? `https://produto.mercadolivre.com.br/${item.item_id}`
    : null,
            titulo:
              produto.name || null,

            preco:
              item.price ?? null,

            moeda:
              item.currency_id || null,

            vendedor:
              item.seller_id || null,

            condicao:
              item.condition || null,

            imagem:
              produto.pictures?.[0]?.url ||
              null,

            frete_gratis:
              item.shipping?.free_shipping ||
              false,

            desconto:
              item.original_price &&
              item.price &&
              item.original_price > item.price
                ? Math.round(
                    (
                      (item.original_price -
                        item.price) /
                      item.original_price
                    ) * 100
                  )
                : 0
          });
        }

      } catch (error) {

        console.error(
          "Erro no produto:",
          produto.id,
          error
        );
      }
    }

    // -------------------------------------------------
    // 4. COMPARAR PREÇOS DO MESMO PRODUTO
    // -------------------------------------------------

    const gruposProdutos = {};

    for (const oferta of ofertas) {
      if (
        !oferta.product_id ||
        oferta.preco === null
      ) {
        continue;
      }

      if (!gruposProdutos[oferta.product_id]) {
        gruposProdutos[oferta.product_id] = [];
      }

      gruposProdutos[oferta.product_id].push(oferta);
    }

    for (const productId of Object.keys(gruposProdutos)) {
      const grupo = gruposProdutos[productId];

      if (grupo.length < 2) {
        continue;
      }

      const precos = grupo
        .map((oferta) => oferta.preco)
        .filter((preco) => typeof preco === "number");

      if (precos.length < 2) {
        continue;
      }

      const media =
        precos.reduce(
          (total, preco) => total + preco,
          0
        ) / precos.length;

      for (const oferta of grupo) {
        oferta.media_preco =
          Math.round(media * 100) / 100;

        oferta.economia_vs_media =
          Math.round(
            ((media - oferta.preco) / media) * 100
          );
      }
    }

    // -------------------------------------------------
    // 5. REMOVER DUPLICADOS
    // -------------------------------------------------
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
    // 5. COLOCAR OS MENORES PREÇOS PRIMEIRO
    // -------------------------------------------------

    ofertasUnicas.sort((a, b) => {

      if (
        a.preco === null &&
        b.preco === null
      ) {
        return 0;
      }

      if (a.preco === null) {
        return 1;
      }

      if (b.preco === null) {
        return -1;
      }

      return a.preco - b.preco;
    });


    // -------------------------------------------------
    // 6. RETORNO
    // -------------------------------------------------

    res.json({
      busca: q,

      produtos_encontrados:
        searchData.results?.length || 0,

      ofertas_encontradas:
        ofertasUnicas.length,

      ofertas:
        ofertasUnicas.slice(0, 50)
    });

  } catch (error) {

    console.error(
      "ERRO GERAL /ofertas:",
      error
    );

    res.status(500).json({
      erro:
        "Erro ao buscar ofertas."
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
