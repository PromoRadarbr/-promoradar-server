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
      erro: "Informe o produto. Exemplo: /ofertas?q=celular"
    });
  }

  if (!accessToken) {
    return res.status(401).json({
      erro: "PromoRadar ainda não está autorizado."
    });
  }

  try {
    const url =
      "https://api.mercadolibre.com/sites/MLB/search" +
      `?q=${encodeURIComponent(q)}` +
      "&limit=20";

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const ofertas = (data.results || []).map((item) => ({
      item_id: item.id || null,
      titulo: item.title || null,
      preco: item.price ?? null,
      preco_original: item.original_price ?? null,
      moeda: item.currency_id || "BRL",
      vendedor: item.seller?.id || null,
      link: item.permalink || null,
      imagem: item.thumbnail || null,
      frete_gratis: item.shipping?.free_shipping || false,
      desconto:
        item.original_price &&
        item.price &&
        item.original_price > item.price
          ? Math.round(
              ((item.original_price - item.price) /
                item.original_price) *
                100
            )
          : 0
    }));

    ofertas.sort((a, b) => {
      if (a.preco === null) return 1;
      if (b.preco === null) return -1;
      return a.preco - b.preco;
    });

    res.json({
      busca: q,
      ofertas_encontradas: ofertas.length,
      ofertas
    });

  } catch (error) {
    console.error("ERRO /ofertas:", error);

    res.status(500).json({
      erro: "Erro ao buscar ofertas."
    });
  }
});


// =====================================================
// NOTIFICAÇÕES
// =====================================================
app.get("/notifications", (req, res) => {
  res.status(200).send("PromoRadar notifications online!");
});
app.post("/notifications", async (req, res) => {
  try {
    const dados = req.body;

    console.log("NOTIFICAÇÃO RECEBIDA:");
    console.log(JSON.stringify(dados, null, 2));
    // Ignora mensagens enviadas pelo próprio PromoRadar
    const mensagensRecebidas =
  dados?.data?.messages ??
  dados?.messages ??
  dados?.[0] ??
  dados;

const mensagem =
  Array.isArray(mensagensRecebidas)
    ? mensagensRecebidas[0]
    : mensagensRecebidas;

if (
  mensagem?.key?.fromMe === true ||
  mensagem?.fromMe === true ||
  mensagem?.from_me === true
) {
  console.log("Mensagem enviada pelo próprio PromoRadar. Ignorando.");
  return res.sendStatus(200);
}

const texto =
    mensagem?.text?.body ??
    mensagem?.message?.text?.body ??
    mensagem?.message?.conversation ??
    mensagem?.messageBody ??
    mensagem?.conversation ??
    mensagem?.body ??
    mensagem?.text ??
    "";

console.log("TEXTO DA MENSAGEM:", texto);

   // Preço
const precosEncontrados = [
  ...texto.matchAll(/R\$\s*([\d.]+(?:,\d{2})?)/gi)
];

const precoOriginal = precosEncontrados[0]
  ? precosEncontrados[0][1]
  : null;

const precoAtual = precosEncontrados[1]
  ? precosEncontrados[1][1]
  : precoOriginal;

// Link
const linkEncontrado = texto.match(
  /https?:\/\/[^\s]+/i
);

// Produto
const linhas = texto
  .split("\n")
  .map(linha => linha.trim())
  .filter(Boolean);

const produtoEncontrado = linhas.find(linha =>
  !/oferta imperdível/i.test(linha) &&
  !/R\$/i.test(linha) &&
  !/https?:\/\//i.test(linha) &&
  !/^\d+%\s*OFF/i.test(linha) &&
  !/^🔥|^🛍️|^❌|^💰|^🔗|^⚡/u.test(linha) &&
  linha.length >= 3
);

const produto = produtoEncontrado
  ? produtoEncontrado
      .replace(/^🛍️\s*/u, "")
      .trim()
  : "Produto não identificado";

const oferta = {
  produto,
  precoOriginal,
  precoAtual,
  link: linkEncontrado
    ? linkEncontrado[0].replace(/[),.;]+$/, "")
    : null
};

    console.log("OFERTA IDENTIFICADA:");
    console.log(JSON.stringify(oferta, null, 2));
    // MENSAGEM PRONTA PARA PUBLICAÇÃO

    const converterPreco = (valor) => {
  if (!valor) return null;

  const numero = String(valor)
    .replace(/R\$/gi, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

  const resultado = Number(numero);

  return Number.isFinite(resultado) ? resultado : null;
};

const valorOriginal = converterPreco(oferta.precoOriginal);
const valorAtual = converterPreco(oferta.precoAtual);

    let desconto = "";

    if (valorOriginal && valorAtual && valorOriginal > valorAtual) {
      const percentual = Math.round(
        ((valorOriginal - valorAtual) / valorOriginal) * 100
      );

      desconto = `📉 ${percentual}% OFF`;
    }

    const mensagemOferta = `🔥 OFERTA IMPERDÍVEL

🛍️ ${oferta.produto}

❌ De R$ ${oferta.precoOriginal || "Consultar"}
💰 Por R$ ${oferta.precoAtual || "Consultar"}

${desconto}

🔗 ${oferta.link || "Link indisponível"}

⚡ PromoRadar | Ofertas`;

    const respostaEnvio = await fetch(
  process.env.WHAPI_API_URL + "/messages/text",
  {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + process.env.WHAPI_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      to: "120363410292212824@newsletter",
      body: mensagemOferta
    })
  }
);

const resultadoEnvio = await respostaEnvio.json();

console.log("RESULTADO DO ENVIO:");
console.log(JSON.stringify(resultadoEnvio, null, 2));

res.sendStatus(200);

  } catch (error) {
    console.error("ERRO AO PROCESSAR NOTIFICAÇÃO:", error);
    res.sendStatus(500);
  }
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
