const express = require("express");

const app = express();

app.use(express.json());

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

// Recebe as notificações do Mercado Livre
app.post("/notifications", (req, res) => {
  console.log("Notificação recebida:", req.body);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
