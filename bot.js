const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const sqlite3 = require('sqlite3').verbose();

// Configuração do banco de dados
const db = new sqlite3.Database('./finance.db', (err) => {
    if (err) console.error(err.message);
    else console.log("Banco de dados conectado!");
});

db.run(`
    CREATE TABLE IF NOT EXISTS transacoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT, 
        valor REAL,
        descricao TEXT,
        categoria TEXT,
        data TEXT
    )
`);

// Configuração do WhatsApp
const client = new Client({
    authStrategy: new LocalAuth()
});

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ Bot conectado!');
});

// Categorias automáticas
const categorizarTransacao = (descricao) => {
    const categorias = {
        transporte: ["uber", "táxi", "ônibus", "passagem"],
        moradia: ["aluguel", "condomínio", "luz", "água", "internet"],
        alimentacao: ["mercado", "restaurante", "comida"],
        lazer: ["cinema", "show", "passeio", "viagem"]
    };
    
    for (let categoria in categorias) {
        if (categorias[categoria].some(keyword => descricao.toLowerCase().includes(keyword))) {
            return categoria;
        }
    }
    return "Outros";
};

// Função para interpretar mensagens
const interpretarMensagem = (mensagem) => {
    const regexReceita = /(recebi|ganhei)\s+(\d+[,.]?\d*)\s*(.+)?/i;
    const regexDespesa = /(gastei|paguei|comprei)\s+(\d+[,.]?\d*)\s*(.+)?/i;

    let tipo = "";
    let valor = 0;
    let descricao = "";
    
    if (regexReceita.test(mensagem)) {
        const match = mensagem.match(regexReceita);
        tipo = "receita";
        valor = parseFloat(match[2].replace(',', '.'));
        descricao = match[3] || "Sem descrição";
    } else if (regexDespesa.test(mensagem)) {
        const match = mensagem.match(regexDespesa);
        tipo = "despesa";
        valor = parseFloat(match[2].replace(',', '.'));
        descricao = match[3] || "Sem descrição";
    }

    return tipo ? { tipo, valor, descricao, categoria: categorizarTransacao(descricao) } : null;
};

client.on('message', async msg => {
    const { body } = msg;
    
    // Verifica se a mensagem é uma transação válida
    const transacao = interpretarMensagem(body);
    if (transacao) {
        const { tipo, valor, descricao, categoria } = transacao;
        const data = new Date().toISOString().split('T')[0];

        db.run(`INSERT INTO transacoes (tipo, valor, descricao, categoria, data) VALUES (?, ?, ?, ?, ?)`, 
            [tipo, valor, descricao, categoria, data], 
            err => {
                if (err) msg.reply("❌ Erro ao registrar transação.");
                else msg.reply(`✅ *${tipo.toUpperCase()}* de *R$${valor.toFixed(2)}* adicionada! \n📌 _${descricao}_ \n📂 Categoria: ${categoria}`);
            }
        );
        return;
    }
    
    if (/saldo/i.test(body)) {
        db.all("SELECT tipo, valor FROM transacoes", [], (err, rows) => {
            if (err) {
                msg.reply("❌ Erro ao obter saldo.");
                return;
            }
            
            let saldo = 0;
            rows.forEach(row => {
                saldo += row.tipo === 'receita' ? row.valor : -row.valor;
            });

            msg.reply(`💰 *Seu saldo atual é:* R$${saldo.toFixed(2)}`);
        });
    }

    else if (/extrato/i.test(body)) {
        db.all("SELECT * FROM transacoes ORDER BY data DESC LIMIT 5", [], (err, rows) => {
            if (err) {
                msg.reply("❌ Erro ao obter extrato.");
                return;
            }
            
            if (rows.length === 0) {
                msg.reply("📭 Nenhuma transação encontrada.");
                return;
            }

            let resposta = "📜 *Últimas transações:*\n";
            rows.forEach(row => {
                resposta += `\n📅 ${row.data} - *${row.tipo.toUpperCase()}* R$${row.valor.toFixed(2)} (_${row.descricao}_) 📂 ${row.categoria}`;
            });

            msg.reply(resposta);
        });
    }

    else if (/ajuda|o que posso fazer/i.test(body)) {
        msg.reply(`🤖 *Comandos disponíveis:*
- 💰 "Quanto tenho de saldo?" → Mostra o saldo atual
- 📜 "Me mostra meu extrato." → Mostra as últimas transações
- 🏷️ "Gastei 50 no Uber" → Registra despesa automaticamente com categoria
- ❓ "O que posso fazer aqui?" → Exibe as funcionalidades.`);
    }
});

client.initialize();
