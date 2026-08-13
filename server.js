const express = require("express");
const crypto = require("crypto");
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

// =====================================================
// CONFIGURAÇÕES
// =====================================================

const ZAPI_URL =
  process.env.ZAPI_URL || "https://api.z-api.io";

const ZAPI_INSTANCE_ID =
  process.env.ZAPI_INSTANCE_ID;

const ZAPI_TOKEN =
  process.env.ZAPI_TOKEN;

const ZAPI_CLIENT_TOKEN =
  process.env.ZAPI_CLIENT_TOKEN;

const WHATSAPP_GROUP_ID =
  process.env.WHATSAPP_GROUP_ID;
const ML_CLIENT_ID =
  process.env.ML_CLIENT_ID;

const ML_CLIENT_SECRET =
  process.env.ML_CLIENT_SECRET;

const ML_REDIRECT_URI =
  process.env.ML_REDIRECT_URI;

let mlAccessToken = null;
let mlRefreshToken = null;
let mlCodeVerifier = null;
let mlState = null;

// =====================================================
// INÍCIO
// =====================================================

app.get("/", (req, res) => {

  res.send("PromoRadar online!");

});


// =====================================================
// STATUS
// =====================================================

app.get("/status", (req, res) => {

  res.json({

    online: true,

    zapi_configurado:
      !!ZAPI_INSTANCE_ID &&
      !!ZAPI_TOKEN &&
      !!ZAPI_CLIENT_TOKEN,

    grupo_configurado:
      !!WHATSAPP_GROUP_ID,

    servidor:
      "PromoRadar"

  });

});


// =====================================================
// NOTIFICAÇÕES
// =====================================================

app.post("/notifications", (req, res) => {

  console.log("====================================");

  console.log(
    "NOTIFICAÇÃO RECEBIDA"
  );

  console.log(
    JSON.stringify(
      req.body,
      null,
      2
    )
  );

  console.log("====================================");

  res.status(200).json({

    recebido: true

  });

});


// =====================================================
// LISTAR GRUPOS
// =====================================================

app.get("/grupos", async (req, res) => {

  if (
    !ZAPI_INSTANCE_ID ||
    !ZAPI_TOKEN ||
    !ZAPI_CLIENT_TOKEN
  ) {

    return res.status(500).json({

      erro:
        "Z-API não configurada corretamente."

    });

  }

  try {

    const url =
      `${ZAPI_URL}/instances/` +
      `${ZAPI_INSTANCE_ID}/token/` +
      `${ZAPI_TOKEN}/groups` +
      `?page=1&pageSize=100`;

    const response =
      await fetch(url, {

        method: "GET",

        headers: {

          Accept:
            "application/json",

          "Client-Token":
            ZAPI_CLIENT_TOKEN

        }

      });

    const data =
      await response.json();

    if (!response.ok) {

      return res
        .status(response.status)
        .json(data);

    }

    res.json(data);

  } catch (error) {

    console.error(
      "ERRO /grupos:",
      error
    );

    res.status(500).json({

      erro:
        "Erro ao buscar grupos do WhatsApp."

    });

  }

});


// =====================================================
// BUSCAR OFERTAS NO MERCADO LIVRE
// =====================================================

app.get("/ofertas", async (req, res) => {

  const { q } =
    req.query;

  if (!q) {

    return res.status(400).json({

      erro:
        "Informe o produto. Exemplo: /ofertas?q=celular"

    });

  }

  try {

    const url =
      "https://api.mercadolibre.com/sites/MLB/search" +
      `?q=${encodeURIComponent(q)}` +
      "&limit=20" +
      "&sort=price_asc";

    const response = await fetch(url, {
    method: "GET",
    headers: {
        "Authorization": `Bearer ${mlAccessToken}`,
        "Accept": "application/json"
    }
});

    const data =
      await response.json();

    if (!response.ok) {

      return res
        .status(response.status)
        .json(data);

    }

    const ofertas =
      (data.results || [])
        .map((item) => {

          let desconto = 0;

          if (
            item.original_price &&
            item.price &&
            item.original_price > item.price
          ) {

            desconto =
              Math.round(

                (
                  (
                    item.original_price -
                    item.price
                  ) /
                  item.original_price
                ) * 100

              );

          }

          return {

            item_id:
              item.id || null,

            titulo:
              item.title || null,

            preco:
              item.price ?? null,

            preco_original:
              item.original_price ?? null,

            desconto,

            link:
              item.permalink || null,

            imagem:
              item.thumbnail || null,

            frete_gratis:
              item.shipping?.free_shipping ||
              false

          };

        });

    res.json({

      busca:
        q,

      produtos_encontrados:
        data.paging?.total || 0,

      ofertas_encontradas:
        ofertas.length,

      ofertas

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
// ENVIAR OFERTA PARA O GRUPO
// =====================================================

// =====================================================
// ENVIAR OFERTA PARA O GRUPO PELO Z-API
// =====================================================

app.get("/enviar", async (req, res) => {

  const { q } = req.query;

  // -------------------------------------------------
  // VALIDAÇÕES
  // -------------------------------------------------

  if (!q) {
    return res.status(400).json({
      erro: "Informe o produto. Exemplo: /enviar?q=celular"
    });
  }

  if (
    !ZAPI_INSTANCE_ID ||
    !ZAPI_TOKEN ||
    !ZAPI_CLIENT_TOKEN
  ) {
    return res.status(500).json({
      erro: "Credenciais da Z-API não configuradas corretamente no Render."
    });
  }

  if (!WHATSAPP_GROUP_ID) {
    return res.status(500).json({
      erro: "WHATSAPP_GROUP_ID não configurado no Render."
    });
  }

  try {

    // -------------------------------------------------
    // BUSCAR PRODUTOS NO MERCADO LIVRE
    // -------------------------------------------------

    const url =
      "https://api.mercadolibre.com/sites/MLB/search" +
      `?q=${encodeURIComponent(q)}` +
      "&limit=20" +
      "&sort=price_asc";

    const response = await fetch(url);

    const data = await response.json();

    if (!response.ok) {
      return res
        .status(response.status)
        .json(data);
    }

    const produtos = data.results || [];

    if (produtos.length === 0) {
      return res.status(404).json({
        erro: "Nenhum produto encontrado."
      });
    }

    // -------------------------------------------------
    // PROCURAR MELHOR OFERTA
    // -------------------------------------------------

    const comDesconto = produtos
      .filter((item) =>
        item.original_price &&
        item.price &&
        item.original_price > item.price
      )
      .sort((a, b) => {

        const descontoA =
          ((a.original_price - a.price) /
            a.original_price) * 100;

        const descontoB =
          ((b.original_price - b.price) /
            b.original_price) * 100;

        return descontoB - descontoA;

      });

    const oferta =
      comDesconto[0] ||
      produtos[0];

    // -------------------------------------------------
    // CALCULAR DESCONTO
    // -------------------------------------------------

    let desconto = 0;

    if (
      oferta.original_price &&
      oferta.price &&
      oferta.original_price > oferta.price
    ) {

      desconto = Math.round(
        (
          (oferta.original_price - oferta.price) /
          oferta.original_price
        ) * 100
      );

    }

    // -------------------------------------------------
    // FORMATAR PREÇOS
    // -------------------------------------------------

    const precoAtual =
      Number(oferta.price)
        .toFixed(2)
        .replace(".", ",");

    const precoOriginal =
      oferta.original_price
        ? Number(oferta.original_price)
            .toFixed(2)
            .replace(".", ",")
        : null;

    // -------------------------------------------------
    // MONTAR MENSAGEM
    // -------------------------------------------------

    let mensagem =
`🔥 *OFERTA PROMORADAR*

🛍️ *${oferta.title}*

💰 *Por R$ ${precoAtual}*`;

    if (precoOriginal) {
      mensagem +=
        `\n❌ De R$ ${precoOriginal}`;
    }

    if (desconto > 0) {
      mensagem +=
        `\n📉 *${desconto}% OFF*`;
    }

    if (oferta.shipping?.free_shipping) {
      mensagem +=
        `\n🚚 *Frete grátis*`;
    }

    mensagem +=
      `\n\n🔗 ${oferta.permalink}`;

    mensagem +=
      `\n\n⚡ *PromoRadar | Ofertas*`;

    // -------------------------------------------------
    // ENVIAR PELO Z-API
    // -------------------------------------------------

    const zapiUrl =
      `${ZAPI_URL}/instances/${ZAPI_INSTANCE_ID}` +
      `/token/${ZAPI_TOKEN}/send-text`;

    const envio = await fetch(zapiUrl, {

      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Client-Token": ZAPI_CLIENT_TOKEN
      },

      body: JSON.stringify({
        phone: WHATSAPP_GROUP_ID,
        message: mensagem
      })

    });

    const resultado = await envio.json();

    // -------------------------------------------------
    // VERIFICAR ENVIO
    // -------------------------------------------------

    if (!envio.ok) {

      console.error(
        "ERRO Z-API:",
        resultado
      );

      return res
        .status(envio.status)
        .json({

          enviado: false,

          erro: "Erro ao enviar oferta pelo Z-API.",

          detalhes: resultado

        });

    }

    // -------------------------------------------------
    // SUCESSO
    // -------------------------------------------------

    res.json({

      enviado: true,

      resultado: resultado,

      produto: oferta.title,

      preco: oferta.price,

      desconto: desconto,

      link: oferta.permalink

    });

  } catch (error) {

    console.error(
      "ERRO /enviar:",
      error
    );

    res.status(500).json({

      enviado: false,

      erro:
        "Erro ao processar e enviar a oferta."

    });

  }

});
// =====================================================
// TESTE Z-API
// =====================================================

app.get("/teste-whatsapp", async (req, res) => {

  if (!ZAPI_INSTANCE_ID || !ZAPI_TOKEN || !ZAPI_CLIENT_TOKEN) {
    return res.status(500).json({
      erro: "Credenciais da Z-API não configuradas."
    });
  }

  try {

    const resposta = await fetch(
      `${ZAPI_URL}/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Client-Token": ZAPI_CLIENT_TOKEN
        },

        body: JSON.stringify({
          phone: WHATSAPP_GROUP_ID,
          message: "🟢 Teste PromoRadar — Z-API funcionando!"
        })
      }
    );

    const resultado = await resposta.json();

    console.log("RESPOSTA Z-API:", resultado);

    if (!resposta.ok) {
      return res.status(resposta.status).json({
        enviado: false,
        resultado
      });
    }

    res.json({
      enviado: true,
      resultado
    });

  } catch (error) {

    console.error("ERRO TESTE Z-API:", error);

    res.status(500).json({
      enviado: false,
      erro: "Erro ao conectar com a Z-API."
    });

  }

});
// =====================================================
// AUTORIZAÇÃO MERCADO LIVRE
// =====================================================

app.get("/auth", (req, res) => {

  if (!ML_CLIENT_ID || !ML_REDIRECT_URI) {
    return res.status(500).json({
      erro: "ML_CLIENT_ID ou ML_REDIRECT_URI não configurado."
    });
  }

  mlCodeVerifier = crypto
    .randomBytes(64)
    .toString("base64url");

  const mlCodeChallenge = crypto
    .createHash("sha256")
    .update(mlCodeVerifier)
    .digest("base64url");

  mlState = crypto
    .randomBytes(32)
    .toString("hex");

  const authorizationUrl =
    "https://auth.mercadolivre.com.br/authorization" +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(ML_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(ML_REDIRECT_URI)}` +
    `&code_challenge=${encodeURIComponent(mlCodeChallenge)}` +
    `&code_challenge_method=S256` +
    `&state=${encodeURIComponent(mlState)}`;

  res.redirect(authorizationUrl);
});


// =====================================================
// CALLBACK MERCADO LIVRE
// =====================================================

app.get("/auth/callback", async (req, res) => {

  const {
    code,
    state,
    error,
    error_description
  } = req.query;

  if (error) {
    return res.status(400).json({
      erro: error,
      descricao: error_description || null
    });
  }

  if (!code) {
    return res.status(400).json({
      erro: "Código de autorização não recebido."
    });
  }

  if (!state || state !== mlState) {
    return res.status(400).json({
      erro: "State inválido."
    });
  }

  if (!mlCodeVerifier) {
    return res.status(400).json({
      erro: "Code verifier não encontrado."
    });
  }

  try {

    const body = new URLSearchParams();

    body.append("grant_type", "authorization_code");
    body.append("client_id", ML_CLIENT_ID);
    body.append("client_secret", ML_CLIENT_SECRET);
    body.append("code", code);
    body.append("redirect_uri", ML_REDIRECT_URI);
    body.append("code_verifier", mlCodeVerifier);

    const response = await fetch(
      "https://api.mercadolibre.com/oauth/token",
      {
        method: "POST",

        headers: {
          "Accept": "application/json",
          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body: body.toString()
      }
    );

    const data = await response.json();

    if (!response.ok) {

      console.error(
        "ERRO TOKEN MERCADO LIVRE:",
        data
      );

      return res
        .status(response.status)
        .json(data);
    }

    mlAccessToken = data.access_token;
    mlRefreshToken = data.refresh_token;

    mlCodeVerifier = null;
    mlState = null;

    res.json({
      sucesso: true,
      mensagem:
        "Mercado Livre autorizado com sucesso.",
      access_token_configurado:
        !!mlAccessToken,
      refresh_token_configurado:
        !!mlRefreshToken,
      user_id:
        data.user_id || null,
      expires_in:
        data.expires_in || null
    });

  } catch (error) {

    console.error(
      "ERRO CALLBACK MERCADO LIVRE:",
      error
    );

    res.status(500).json({
      erro:
        "Erro ao obter Access Token do Mercado Livre."
    });
  }
});
// =====================================================
// SERVIDOR
// =====================================================

app.listen(

  PORT,

  () => {

    console.log(

      `Servidor PromoRadar ` +
      `rodando na porta ${PORT}`

    );

  }

);
