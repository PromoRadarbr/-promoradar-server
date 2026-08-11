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

  try {
    const url =
      `https://api.mercadolibre.com/sites/MLB/search` +
      `?q=${encodeURIComponent(q)}` +
      `&limit=20`;

    const response = await fetch(url, {
  headers: {
    Authorization: `Bearer ${accessToken}`
  }
});

const data = await response.json();
    

    if (!response.ok) {
      console.error("Erro na busca:", data);
      return res.status(response.status).json(data);
    }

    const ofertas = data.results.map((item) => {
      const precoAtual = item.price;
      const precoOriginal = item.original_price;

      let desconto = 0;

      if (
        precoOriginal &&
        precoAtual &&
        precoOriginal > precoAtual
      ) {
        desconto = Math.round(
          ((precoOriginal - precoAtual) /
            precoOriginal) * 100
        );
      }

      return {
        id: item.id,
        produto: item.title,
        preco_atual: precoAtual,
        preco_original: precoOriginal,
        desconto: desconto,
        imagem: item.thumbnail || null,
        link: item.permalink || null
      };
    });

    ofertas.sort((a, b) => b.desconto - a.desconto);

    res.json({
      busca: q,
      total_encontrado: data.paging?.total || 0,
      ofertas_encontradas: ofertas.length,
      ofertas: ofertas
    });

  } catch (error) {
    console.error("Erro ao buscar ofertas:", error);

    res.status(500).send(
      "Erro ao buscar ofertas no Mercado Livre."
    );
  }
});
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `Servidor rodando na porta ${PORT}`
  );
});
