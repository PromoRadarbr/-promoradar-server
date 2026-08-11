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
// AUTORIZAÇÃO
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
      <h1>PromoRadar conectado!</h1>
      <p>Autorização realizada com sucesso.</p>
      <p>Usuário Mercado Livre: ${data.user_id}</p>
    `);

  } catch (error) {
    console.error("ERRO OAUTH:", error);

    res.status(500).send(
      "Erro interno ao conectar com o Mercado Livre."
    );
  }
});


// =====================================================
// TESTAR MERCADO LIVRE
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
      (data.results || []).map((item) => ({
        product_id:
          item.id || null,

        titulo:
          item.name || null,

        imagem:
          item.pictures?.[0]?.url || null
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
    // 1. BUSCAR PRODUTOS DE CATÁLOGO
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

    const searchResponse = await fetch(
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
    // 2. BUSCAR PUBLICAÇÕES DOS PRODUTOS
    // -------------------------------------------------

    const ofertas = [];

    for (
      const produto
      of searchData.results || []
    ) {

      try {

        const itemsUrl =
          `https://api.mercadolibre.com/products/${produto.id}/items?limit=20`;

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
          "PUBLICAÇÕES:",
          itemsData.results?.length || 0
        );

        if (!itemsResponse.ok) {
          continue;
        }


        // -------------------------------------------------
        // 3. TRANSFORMAR PUBLICAÇÕES EM OFERTAS
        // -------------------------------------------------

        for (
          const item
          of itemsData.results || []
        ) {

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

          ofertas.push({

            product_id:
              produto.id,

            item_id:
              item.item_id || null,

            titulo:
              produto.name || null,

            preco:
              preco,

            preco_original:
              precoOriginal,

            desconto:
              desconto,

            moeda:
              item.currency_id || null,

            imagem:
              produto.pictures?.[0]?.url ||
              null,

            link:
              item.permalink || null,

            vendedor:
              item.seller_id || null,

            condicao:
              item.condition || null
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
    // 5. ORDENAR
    // -------------------------------------------------

    ofertasUnicas.sort(
      (a, b) =>
        b.desconto - a.desconto
    );


    // -------------------------------------------------
    // 6. RESPOSTA
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
// =====================================================
// TESTAR DETALHES DE UMA OFERTA
// =====================================================

app.get("/teste-item", async (req, res) => {
  const itemId = req.query.id;

  if (!itemId) {
    return res.status(400).json({
      erro: "Informe o item. Exemplo: /teste-item?id=MLB5008947313"
    });
  }

  if (!accessToken) {
    return res.status(401).json({
      erro: "PromoRadar ainda não está autorizado."
    });
  }

  try {
    const itemResponse = await fetch(
      `https://api.mercadolibre.com/items/${itemId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const itemData = await itemResponse.json();

    const pricesResponse = await fetch(
      `https://api.mercadolibre.com/items/${itemId}/prices`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const pricesData = await pricesResponse.json();

    res.json({
      item_status: itemResponse.status,
      item: itemData,

      prices_status: pricesResponse.status,
      prices: pricesData
    });

  } catch (error) {
    console.error("ERRO /teste-item:", error);

    res.status(500).json({
      erro: "Erro ao consultar o anúncio."
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
      !!accessToken
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
