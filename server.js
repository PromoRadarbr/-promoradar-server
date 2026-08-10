const express = require("express");

const app = express();
let accessToken = null;

app.use(express.json());

// Página inicial
app.get("/", (req, res) => {
  res.send("PromoRadar online!");
});

// Inicia a autorização do Mercado Livre
app.get("/auth", (req, res) => {
  const clientId = process.env.ML_CLIENT_ID;
  const redirectUri = process.env.ML_REDIRECT_URI;

  const authUrl =
    `https://auth.mercadolivre.com.br/authorization` +
    `?response_type=code` +
    `&client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  res.redirect(authUrl);
});

// Recebe o código de autorização do Mercado Livre
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
          "content-type": "application/x-www-form-urlencoded"
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
    console.error("Erro OAuth:", error);

    res
      .status(500)
      .send("Erro interno ao conectar com o Mercado Livre.");
  }
});

// Recebe notificações do Mercado Livre
app.post("/notifications", (req, res) => {
  console.log(
    "Notificação recebida:",
    req.body
  );

  res.sendStatus(200);
});

// Testa a conexão com a API do Mercado Livre
app.get("/test-ml", async (req, res) => {
  if (!accessToken) {
    return res
      .status(401)
      .send("PromoRadar ainda não está autorizado.");
  }

  try {
    const response = await fetch(
      "https://api.mercadolibre.com/users/me",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(
        "Erro na API do Mercado Livre:",
        data
      );

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
    console.error("Erro:", error);

    res
      .status(500)
      .send("Erro ao consultar o Mercado Livre.");
  }
});

// Busca produtos no catálogo do Mercado Livre
app.get("/buscar", async (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({
      erro: "Informe o produto. Exemplo: /buscar?q=iphone"
    });
  }

  try {
    const url =
      `https://api.mercadolibre.com/products/search` +
      `?status=active` +
      `&site_id=MLB` +
      `&q=${encodeURIComponent(q)}` +
      `&limit=10`;

    const response = await fetch(url);

    const data = await response.json();

    if (!response.ok) {
      console.error(
        "Erro na busca de produtos:",
        data
      );

      return res
        .status(response.status)
        .json(data);
    }

    const produtos = data.results.map((item) => ({
      id: item.id,
      nome: item.name,
      status: item.status,
      dominio: item.domain_id,
      imagem: item.pictures?.[0]?.url || null
    }));

    res.json({
      busca: q,
      total: data.paging.total,
      produtos
    });

  } catch (error) {
    console.error(
      "Erro ao buscar produtos:",
      error
    );

    res
      .status(500)
      .send("Erro ao buscar produtos no Mercado Livre.");
  }
});

// Busca ofertas no Mercado Livre
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
    // 1. Busca produtos no catálogo
    const searchUrl =
      `https://api.mercadolibre.com/products/search` +
      `?status=active` +
      `&site_id=MLB` +
      `&q=${encodeURIComponent(q)}` +
      `&limit=5`;

    const searchResponse = await fetch(searchUrl);

    const searchData = await searchResponse.json();

    if (!searchResponse.ok) {
      console.error(
        "Erro na busca do catálogo:",
        searchData
      );

      return res
        .status(searchResponse.status)
        .json(searchData);
    }

    const ofertas = [];

    // 2. Consulta cada produto
    for (const produto of searchData.results) {
      try {
        const productResponse = await fetch(
          `https://api.mercadolibre.com/products/${produto.id}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        );

        const productData =
          await productResponse.json();

        if (!productResponse.ok) {
          console.error(
            "Erro ao consultar produto:",
            productData
          );

          continue;
        }

        // 3. Pega o anúncio vencedor
        const itemId =
          productData.buy_box_winner?.item_id;

        if (!itemId) {
          continue;
        }

        // 4. Consulta o anúncio
        const itemResponse = await fetch(
          `https://api.mercadolibre.com/items/${itemId}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        );

        const item =
          await itemResponse.json();

        if (!itemResponse.ok) {
          console.error(
            "Erro ao consultar anúncio:",
            item
          );

          continue;
        }

        const precoAtual = item.price;
        const precoOriginal = item.original_price;

        let desconto = 0;

        if (
          precoOriginal &&
          precoOriginal > precoAtual
        ) {
          desconto = Math.round(
            (
              (precoOriginal - precoAtual) /
              precoOriginal
            ) * 100
          );
        }

        ofertas.push({
          produto: produto.name,
          item_id: item.id,
          preco_atual: precoAtual,
          preco_original: precoOriginal,
          desconto: desconto,
          imagem: item.thumbnail || null,
          link: item.permalink || null
        });

      } catch (error) {
        console.error(
          "Erro ao processar produto:",
          error
        );
      }
    }

    // 5. Melhores descontos primeiro
    ofertas.sort(
      (a, b) => b.desconto - a.desconto
    );

    res.json({
      busca: q,
      ofertas_encontradas: ofertas.length,
      ofertas
    });

  } catch (error) {
    console.error(
      "Erro ao buscar ofertas:",
      error
    );

    res
      .status(500)
      .send("Erro ao buscar ofertas no Mercado Livre.");
  }
});

// Inicia o servidor
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `Servidor rodando na porta ${PORT}`
  );
});
