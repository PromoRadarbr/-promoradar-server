const express = require("express");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

// =====================================================
// CONFIGURAÇÕES
// =====================================================

const WHAPI_API_URL =
  (process.env.WHAPI_API_URL || "https://gate.whapi.cloud").replace(/\/$/, "");

const WHAPI_TOKEN = process.env.WHAPI_TOKEN;

// ID DO CANAL PROMORADAR
const CANAL_PROMORADAR =
  "120363410292212824@newsletter";

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
    whatsapp_configurado: !!WHAPI_TOKEN,
    servidor: "PromoRadar"
  });
});

// =====================================================
// BUSCAR OFERTAS NO MERCADO LIVRE
// =====================================================

app.get("/ofertas", async (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({
      erro: "Informe o produto. Exemplo: /ofertas?q=celular"
    });
  }

  try {
    const url =
      "https://api.mercadolibre.com/sites/MLB/search" +
      `?q=${encodeURIComponent(q)}` +
      "&limit=20" +
      "&sort=price_asc";

    const response = await fetch(url);

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const ofertas = (data.results || []).map((item) => {

      let desconto = 0;

      if (
        item.original_price &&
        item.price &&
        item.original_price > item.price
      ) {
        desconto = Math.round(
          ((item.original_price - item.price) /
            item.original_price) *
            100
        );
      }

      return {
        item_id: item.id || null,

        titulo: item.title || null,

        preco: item.price ?? null,

        preco_original:
          item.original_price ?? null,

        desconto,

        link:
          item.permalink || null,

        imagem:
          item.thumbnail || null,

        frete_gratis:
          item.shipping?.free_shipping || false
      };
    });

    res.json({
      busca: q,

      produtos_encontrados:
        data.paging?.total || 0,

      ofertas_encontradas:
        ofertas.length,

      ofertas
    });

  } catch (error) {

    console.error("ERRO /ofertas:", error);

    res.status(500).json({
      erro: "Erro ao buscar ofertas no Mercado Livre."
    });
  }
});

// =====================================================
// ENVIAR OFERTA PARA O CANAL PROMORADAR
// =====================================================

app.get("/enviar", async (req, res) => {

  const { q } = req.query;

  if (!q) {
    return res.status(400).json({
      erro: "Informe o produto. Exemplo: /enviar?q=celular"
    });
  }

  if (!WHAPI_TOKEN) {
    return res.status(500).json({
      erro: "WHAPI_TOKEN não configurado no Render."
    });
  }

  try {

    // -------------------------------------------------
    // BUSCAR PRODUTOS
    // -------------------------------------------------

    const url =
      "https://api.mercadolibre.com/sites/MLB/search" +
      `?q=${encodeURIComponent(q)}` +
      "&limit=20" +
      "&sort=price_asc";

    const response = await fetch(url);

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const produtos = data.results || [];

    if (produtos.length === 0) {
      return res.status(404).json({
        erro: "Nenhum produto encontrado."
      });
    }

    // -------------------------------------------------
    // ESCOLHER OFERTA
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
      comDesconto[0] || produtos[0];

    let desconto = 0;

    if (
      oferta.original_price &&
      oferta.price &&
      oferta.original_price > oferta.price
    ) {

      desconto = Math.round(
        ((oferta.original_price - oferta.price) /
          oferta.original_price) *
          100
      );
    }

    // -------------------------------------------------
    // MONTAR MENSAGEM
    // -------------------------------------------------

    let mensagem = `🔥 *OFERTA PROMORADAR*

🛍️ *${oferta.title}*

💰 *Por R$ ${Number(oferta.price)
      .toFixed(2)
      .replace(".", ",")}*`;

    if (oferta.original_price) {

      mensagem +=
        `\n❌ De R$ ${Number(oferta.original_price)
          .toFixed(2)
          .replace(".", ",")}`;
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
      `\n\n⚡ PromoRadar | Ofertas`;

    // -------------------------------------------------
    // ENVIAR PARA WHATSAPP
    // -------------------------------------------------

    const envio = await fetch(
      `${WHAPI_API_URL}/messages/text`,
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${WHAPI_TOKEN}`,

          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          to: CANAL_PROMORADAR,
          body: mensagem
        })
      }
    );

    const resultado =
      await envio.json();

    if (!envio.ok) {

      console.error(
        "ERRO WHAPI:",
        resultado
      );

      return res.status(envio.status).json({
        erro: "Erro ao enviar para o WhatsApp.",
        detalhes: resultado
      });
    }

    // -------------------------------------------------
    // SUCESSO
    // -------------------------------------------------

    res.json({

      enviado: true,

      produto:
        oferta.title,

      preco:
        oferta.price,

      desconto,

      link:
        oferta.permalink,

      whatsapp:
        resultado

    });

  } catch (error) {

    console.error(
      "ERRO /enviar:",
      error
    );

    res.status(500).json({
      erro:
        "Erro ao processar e enviar a oferta."
    });
  }
});

// =====================================================
// SERVIDOR
// =====================================================

app.listen(PORT, () => {

  console.log(
    `Servidor PromoRadar rodando na porta ${PORT}`
  );

});
