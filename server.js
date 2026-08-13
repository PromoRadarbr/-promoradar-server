const express = require("express");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

// =====================================================
// CONFIGURAÇÕES
// =====================================================

const WHAPI_API_URL = "https://gate.whapi.cloud";

const WHAPI_API_TOKEN =
  process.env.WHAPI_API_TOKEN;

const WHATSAPP_GROUP_ID =
  process.env.WHATSAPP_GROUP_ID;


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
    whapi_configurado: !!WHAPI_API_TOKEN,
    grupo_configurado: !!WHATSAPP_GROUP_ID,
    servidor: "PromoRadar"
  });

});


// =====================================================
// NOTIFICAÇÕES
// =====================================================

app.post("/notifications", (req, res) => {

  console.log("====================================");
  console.log("NOTIFICAÇÃO RECEBIDA");
  console.log(JSON.stringify(req.body, null, 2));
  console.log("====================================");

  res.status(200).json({
    recebido: true
  });

});


// =====================================================
// LISTAR GRUPOS DO WHATSAPP
// =====================================================

app.get("/grupos", async (req, res) => {

  if (!WHAPI_API_TOKEN) {

    return res.status(500).json({
      erro: "WHAPI_API_TOKEN não configurado."
    });

  }

  try {

    const response = await fetch(
      `${WHAPI_API_URL}/groups?count=100`,
      {
        method: "GET",

        headers: {
          Accept: "application/json",
          Authorization:
            `Bearer ${WHAPI_API_TOKEN}`
        }
      }
    );

    const data = await response.json();

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

  const { q } = req.query;

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

    const response =
      await fetch(url);

    const data =
      await response.json();

    if (!response.ok) {

      return res
        .status(response.status)
        .json(data);

    }

    const ofertas =
      (data.results || []).map((item) => {

        let desconto = 0;

        if (
          item.original_price &&
          item.price &&
          item.original_price > item.price
        ) {

          desconto =
            Math.round(
              (
                (item.original_price - item.price) /
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

app.get("/enviar", async (req, res) => {

  const { q } = req.query;

  if (!q) {

    return res.status(400).json({
      erro:
        "Informe o produto. Exemplo: /enviar?q=celular"
    });

  }

  if (!WHAPI_API_TOKEN) {

    return res.status(500).json({
      erro:
        "WHAPI_API_TOKEN não configurado."
    });

  }

  if (!WHATSAPP_GROUP_ID) {

    return res.status(500).json({
      erro:
        "WHATSAPP_GROUP_ID não configurado no Render."
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

    const response =
      await fetch(url);

    const data =
      await response.json();

    if (!response.ok) {

      return res
        .status(response.status)
        .json(data);

    }

    const produtos =
      data.results || [];

    if (produtos.length === 0) {

      return res.status(404).json({
        erro:
          "Nenhum produto encontrado."
      });

    }


    // -------------------------------------------------
    // PROCURAR A MELHOR OFERTA
    // -------------------------------------------------

    const comDesconto =
      produtos
        .filter((item) =>
          item.original_price &&
          item.price &&
          item.original_price > item.price
        )
        .sort((a, b) => {

          const descontoA =
            (
              (a.original_price - a.price) /
              a.original_price
            ) * 100;

          const descontoB =
            (
              (b.original_price - b.price) /
              b.original_price
            ) * 100;

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

      desconto =
        Math.round(
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
    // ENVIAR PELO WHAPI
    // -------------------------------------------------

    const envio =
      await fetch(
        `${WHAPI_API_URL}/messages/text`,
        {

          method: "POST",

          headers: {

            Accept:
              "application/json",

            Authorization:
              `Bearer ${WHAPI_API_TOKEN}`,

            "Content-Type":
              "application/json"

          },

          body:
            JSON.stringify({

              to:
                WHATSAPP_GROUP_ID,

              body:
                mensagem

            })

        }
      );

    const resultado =
      await envio.json();


    // -------------------------------------------------
    // VERIFICAR ENVIO
    // -------------------------------------------------

    if (!envio.ok) {

      console.error(
        "ERRO WHAPI:",
        resultado
      );

      return res
        .status(envio.status)
        .json({

          enviado: false,

          erro:
            "Erro ao enviar para o grupo.",

          detalhes:
            resultado

        });

    }


    // -------------------------------------------------
    // SUCESSO
    // -------------------------------------------------

    res.json({

      enviado: true,

      grupo:
        WHATSAPP_GROUP_ID,

      produto:
        oferta.title,

      preco:
        oferta.price,

      desconto,

      link:
        oferta.permalink,

      resposta_whapi:
        resultado

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
// SERVIDOR
// =====================================================

app.listen(
  PORT,
  () => {

    console.log(
      `Servidor PromoRadar rodando na porta ${PORT}`
    );

  }
);
