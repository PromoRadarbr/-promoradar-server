const express = require("express");

const app = express();
app.use(express.json());

let accessToken = null;
let refreshToken = null;


// ================================
// INÍCIO
// ================================

app.get("/", (req, res) => {
  res.send("PromoRadar online!");
});


// ================================
// AUTORIZAÇÃO MERCADO LIVRE
// ================================

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


// ================================
// CALLBACK
// ================================

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
      console.error("Erro OAuth:", data);
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
      <p>Usuário: ${data.user_id}</p>
    `);

  } catch (error) {
    console.error("Erro OAuth:", error);

    res
      .status(500)
      .send(
        "Erro interno ao conectar com o Mercado Livre."
      );
  }
});


// ================================
// TESTAR MERCADO LIVRE
// ================================

app.get("/test-ml", async (req, res) => {
  if (!accessToken) {
    return res.status(401).send(
      "PromoRadar ainda não está autorizado."
    );
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
      usuario: data.nickname,
      id: data.id,
      pais: data.country_id
    });

  } catch (error) {
    console.error("Erro /test-ml:", error);

    res
      .status(500)
      .send(
        "Erro ao consultar o Mercado Livre."
      );
  }
});


// ================================
// BUSCAR PRODUTOS
// ================================

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
      "https://api.mercadolibre.com/products/search" +
      "?status=active" +
      "&site_id=MLB" +
      `&q=${encodeURIComponent(q)}` +
      "&limit=20";

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res
        .status(response.status)
        .json(data);
    }

    const produtos =
      (data.results || []).map((item) => ({
        id: item.id,
        nome: item.name,
        status: item.status,
        dominio: item.domain_id,
        imagem:
          item.pictures?.[0]?.url || null
      }));

    res.json({
      busca: q,
      total: data.paging?.total || 0,
      produtos
    });

  } catch (error) {
    console.error("Erro /buscar:", error);

    res
      .status(500)
      .send(
        "Erro ao buscar produtos no Mercado Livre."
      );
  }
});


// ================================
// BUSCAR OFERTAS
// ================================

app.get("/ofertas", async (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({
      erro: "Informe o produto. Exemplo: /ofertas?q=iphone"
    });
  }

  if (!accessToken) {
    return res.status(401).send(
      "PromoRadar ainda não está autorizado."
    );
  }

  try {
    const searchUrl =
      "https://api.mercadolibre.com/products/search" +
      "?status=active" +
      "&site_id=MLB" +
      `&q=${encodeURIComponent(q)}` +
      "&limit=20";

    const searchResponse = await fetch(searchUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const searchData = await searchResponse.json();

    if (!searchResponse.ok) {
      console.error(
        "Erro na busca de produtos:",
        searchData
      );

      return res
        .status(searchResponse.status)
        .json(searchData);
    }

    const ofertas = [];

    for (const produto of searchData.results || []) {
      try {
        const productResponse = await fetch(
          `https://api.mercadolibre.com/products/${produto.id}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        );

        if (!productResponse.ok) {
          console.log(
            "Produto ignorado:",
            produto.id,
            productResponse.status
          );
          continue;
        }

        const productData =
          await productResponse.json();

        const winner =
          productData.buy_box_winner;

        if (!winner || !winner.item_id) {
          continue;
        }

        const preco =
          winner.price ?? null;

        const precoOriginal =
          winner.original_price ?? null;

        let desconto = 0;

        if (
          precoOriginal &&
          preco &&
          precoOriginal > preco
        ) {
          desconto = Math.round(
            ((precoOriginal - preco) /
              precoOriginal) *
              100
          );
        }

        ofertas.push({
          product_id: productData.id,
          item_id: winner.item_id,
          titulo: productData.name || null,
          preco: preco,
          preco_original: precoOriginal,
          desconto: desconto,
          moeda: winner.currency_id || null,
          vendedor: winner.seller_id || null,
          condicao: winner.condition || null,
          imagem:
            productData.pictures?.[0]?.url || null,
          link: productData.permalink || null
        });

      } catch (error) {
        console.error(
          "Erro ao consultar produto:",
          produto.id,
          error
        );
      }
    }

    ofertas.sort(
      (a, b) => b.desconto - a.desconto
    );

    res.json({
      busca: q,
      produtos_encontrados:
        searchData.results?.length || 0,
      ofertas_encontradas:
        ofertas.length,
      ofertas
    });

  } catch (error) {
    console.error(
      "Erro /ofertas:",
      error
    );

    res.status(500).send(
      "Erro ao buscar ofertas no Mercado Livre."
    );
  }
});

// ================================
// NOTIFICAÇÕES
// ================================

app.post("/notifications", (req, res) => {
  console.log(
    "Notificação recebida:",
    req.body
  );

  res.sendStatus(200);
});


// ================================
// SERVIDOR
// ================================

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `Servidor rodando na porta ${PORT}`
  );
});
