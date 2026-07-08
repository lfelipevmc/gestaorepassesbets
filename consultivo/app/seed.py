"""Dados de demonstração — conversas jurídicas realistas por WhatsApp.

Roda via endpoint POST /api/seed-demo ou por linha de comando:
    python -m app.seed
"""
from datetime import datetime, timedelta

from .database import Base, SessionLocal, engine
from .models import Cliente
from .services import segmentacao
from .services.whatsapp import ingerir_mensagem

# telefone -> (nome, empresa, contrato_mensal, [ (dia, hora, min, direcao, texto), ... ])
_DEMO = {
    "5511988887777": (
        "Construtora Aurora Ltda.",
        "Aurora Engenharia",
        3500.0,
        [
            (0, 9, 12, "in", "Bom dia, dr.! Um funcionário pediu demissão mas quer que a gente pague aviso. Somos obrigados?"),
            (0, 9, 25, "out", "Bom dia! Se o pedido de demissão partiu do empregado, não há aviso a pagar pela empresa. Ele é quem deve cumprir ou indenizar o aviso, salvo dispensa desse cumprimento por vocês."),
            (0, 9, 31, "in", "Entendi. E se a gente dispensar o cumprimento, desconta algo?"),
            (0, 9, 40, "out", "Se vocês dispensarem, não descontam nada. Só formalizem por escrito para evitar discussão futura."),
            (0, 9, 42, "in", "Perfeito, obrigado!"),
            (2, 14, 3, "in", "Dr., recebemos uma notificação extrajudicial de um fornecedor cobrando multa contratual. Pode dar uma olhada no contrato e responder?"),
            (2, 14, 20, "out", "Claro. Me encaminhe o contrato e a notificação que eu analiso a cláusula de multa e preparo a resposta."),
            (2, 14, 22, "in", "Mando agora por e-mail. Preciso protocolar a resposta até sexta."),
        ],
    ),
    "5511977776666": (
        "Marina Prado",
        "Prado Cosméticos ME",
        2200.0,
        [
            (1, 11, 0, "in", "Oi doutor, posso contratar como MEI ou preciso abrir ME para vender pelo site?"),
            (1, 11, 15, "out", "Depende do faturamento e do CNAE. Se ultrapassar o limite do MEI ou tiver atividade não permitida, o caminho é ME. Me diz o faturamento estimado que eu confirmo."),
            (1, 11, 18, "in", "Uns 12 mil por mês."),
            (1, 11, 26, "out", "Nesse patamar você já ultrapassa o teto do MEI. Recomendo constituir ME no Simples. Posso elaborar o contrato social se quiser."),
            (3, 16, 5, "in", "Doutor, um cliente quer devolver produto depois de 40 dias alegando defeito. Sou obrigada?"),
            (3, 16, 14, "out", "Para vício de qualidade, o CDC dá 90 dias para produto durável a contar de quando o defeito aparece. Se for defeito real e dentro desse prazo, sim, há obrigação de sanar. Peça que ele descreva o defeito por escrito."),
            (3, 16, 17, "in", "Ah, não sabia. Muito obrigada!"),
        ],
    ),
    "5511966665555": (
        "Tech Nova Sistemas",
        "Tech Nova",
        0.0,
        [
            (0, 10, 0, "in", "Bom dia! Estamos fechando com um cliente grande e ele mandou um contrato de prestação. Vocês revisam?"),
            (0, 10, 12, "out", "Bom dia! Sim, revisamos. Me envie a minuta que eu analiso cláusulas de responsabilidade, propriedade intelectual e rescisão."),
            (0, 10, 15, "in", "Enviado. É urgente, assinam segunda."),
        ],
    ),
}


def rodar():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    base = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=6)
    criados = 0
    try:
        for telefone, (nome, empresa, contrato, msgs) in _DEMO.items():
            # pula se já existir esse cliente (evita duplicar no demo)
            from .models import Cliente as C
            if db.query(C).filter(C.telefone == telefone).first():
                continue
            for i, (dia, hora, minuto, direcao, texto) in enumerate(msgs):
                quando = base + timedelta(days=dia, hours=hora, minutes=minuto)
                cliente = ingerir_mensagem(
                    db, telefone, nome, texto, direcao=direcao,
                    wa_message_id=f"seed-{telefone}-{i}", quando=quando,
                )
            cliente.empresa = empresa
            cliente.valor_contrato_mensal = contrato
            db.commit()
            segmentacao.recompute_atendimentos(db, cliente)
            criados += 1
        return criados
    finally:
        db.close()


if __name__ == "__main__":
    n = rodar()
    print(f"Seed concluído. Clientes de demonstração criados: {n}")
