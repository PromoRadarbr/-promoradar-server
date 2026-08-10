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
    return res.status(400).send("Código de autorização não recebido.");
  }

  try {
    const response = await fetch(
      "https://api.mercadolibre.com/oauth/token",
      {
        method: "POST",
        headers: {
          "accept": "application/json",
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
        .send("Erro ao conectar com o Mercado Livre.");
    }

    console.log("Mercado Livre conectado. Usuário:", data.user_id);
    accessToken = data.access_token;
    res.send(`
      <h1>PromoRadar conectado!</h1>
      <p>Autorização realizada com sucesso.</p>
      <p>Usuário Mercado Livre: ${data.user_id}</p>
    `);

  } catch (error) {
    console.error("Erro:", error);
    res.status(500).send("Erro interno ao conectar com o Mercado Livre.");
  }
});

// Recebe notificações do Mercado Livre
app.post("/notifications", (req, res) => {
  console.log("Notificação recebida:", req.body);
  res.sendStatus(200);
});
// Testa a conexão com a API do Mercado Livre
app.get("/test-ml", async (req, res) => {
  if (!accessToken) {
    return res.status(401).send("PromoRadar ainda não está autorizado.");
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
      console.error("Erro na API do Mercado Livre:", data);
      return res.status(response.status).json(data);
    }

    res.json({
      conectado: true,
      usuario: data.nickname,
      id: data.id,
      pais: data.country_id
    });

  } catch (error) {
    console.error("Erro:", error);
    res.status(500).send("Erro ao consultar o Mercado Livre.");
  }
});
// Busca produtos no Mercado Livre
app.get("/buscar", async (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({
      erro: "Informe o produto. Exemplo: /buscar?q=iphone"
    });
  }

  if (!accessToken) {
    return res.status(401).send(
      "PromoRadar ainda não está autorizado."
    );
  }

  try {
    const url =
      `https://api.mercadolibre.com/sites/MLB/search` +
      `?q=${encodeURIComponent(q)}` +
      `&limit=10`;

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

    const produtos = data.results.map((item) => ({
      id: item.id,
      titulo: item.title,
      preco: item.price,
      preco_original: item.original_price,
      desconto: item.original_price
        ? Math.round(
            ((item.original_price - item.price) /
              item.original_price) *
              100
          )
        : 0,
      imagem: item.thumbnail,
      link: item.permalink
    }));

    res.json({
      busca: q,
      total: data.paging.total,
      produtos
    });

  } catch (error) {
    console.error("Erro ao buscar produtos:", error);
    res.status(500).send(
      "Erro ao buscar produtos no Mercado Livre."
    );
  }
});
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
