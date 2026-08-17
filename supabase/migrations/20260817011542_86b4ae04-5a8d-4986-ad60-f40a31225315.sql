
-- 1) Configuração padrão da IA por empresa (desligada até o admin ativar)
INSERT INTO public.system_settings (company_id, key, value)
SELECT c.id, 'ai',
       jsonb_build_object('enabled', false, 'agentName', 'Assistente',
                          'companyName', c.name, 'extraInstructions', '')
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_settings s WHERE s.company_id = c.id AND s.key = 'ai'
);

-- 2) Base de conhecimento genérica sobre salário-maternidade
WITH artigos(title, category, content) AS (
  VALUES
  ('O que é o salário-maternidade', 'institucional',
'O salário-maternidade (também chamado de auxílio-maternidade) é um benefício pago pelo INSS à pessoa que deu à luz, adotou ou obteve guarda judicial para adoção, sofreu aborto não criminoso ou teve natimorto.
Duração usual: 120 dias no nascimento e na adoção; 14 dias em caso de aborto espontâneo/não criminoso.
Quem paga: para empregada CLT com carteira assinada, geralmente a empresa paga e se compensa com o INSS. Para MEI, autônoma (contribuinte individual), facultativa, empregada doméstica, segurada especial (rural) e desempregada dentro do período de graça, o pagamento é feito diretamente pelo INSS.
A concessão é sempre decisão do INSS: nós preparamos e acompanhamos o pedido, mas não garantimos aprovação.'),

  ('Quem tem direito', 'faq',
'Podem ter direito, desde que mantenham a qualidade de segurada:
- Empregada CLT, trabalhadora doméstica e trabalhadora avulsa;
- MEI e contribuinte individual (autônoma) que recolhem o INSS;
- Contribuinte facultativa;
- Segurada especial (trabalhadora rural, pescadora artesanal, indígena);
- Desempregada que ainda está no período de graça (mantém a qualidade de segurada mesmo sem contribuir);
- Pai/adotante nos casos previstos em lei (adoção, guarda judicial ou falecimento da mãe segurada).
Cada caso é analisado individualmente pela nossa equipe.'),

  ('Carência: quantas contribuições são necessárias', 'carencias',
'- Empregada CLT, doméstica e trabalhadora avulsa: não há carência.
- MEI, contribuinte individual e facultativa: em regra, 10 contribuições mensais (podendo ser reduzida em caso de parto antecipado).
- Segurada especial (rural): comprovação de atividade rural nos 10 meses anteriores ao parto.
- Desempregada: depende do período de graça, que costuma ser de 12 meses após a última contribuição e pode ser prorrogado (até 24 ou 36 meses em situações previstas em lei).
A conferência exata é feita pela nossa equipe com base no CNIS da pessoa.'),

  ('Valor do benefício', 'precos',
'O valor varia conforme o vínculo:
- Empregada CLT: em regra, o valor da remuneração integral do mês.
- MEI e segurada especial: em regra, um salário mínimo.
- Contribuinte individual e facultativa: média dos últimos salários de contribuição, conforme a regra do INSS.
Nunca informe um valor exato ao lead sem análise: o cálculo depende do histórico de contribuições.'),

  ('Prazos para pedir', 'processos',
'- Nascimento, natimorto ou aborto: o pedido pode ser feito em até 5 anos a partir do fato.
- Adoção ou guarda judicial: também até 5 anos.
- Para empregada CLT, o pedido normalmente é feito pela empresa; nos demais casos, direto no INSS (Meu INSS / 135).
Quanto antes o pedido for feito, mais rápido o pagamento começa. Atrasos podem gerar perda de parcelas retroativas em alguns casos.'),

  ('Documentos normalmente necessários', 'processos',
'- Documento de identidade com foto e CPF;
- Certidão de nascimento da criança (ou termo de guarda/adoção; certidão de natimorto; atestado médico em caso de aborto);
- Comprovante de residência;
- Carteira de trabalho e/ou comprovantes de contribuição (guias do MEI, DAS, GPS);
- Para trabalhadora rural: documentos que comprovem a atividade (notas de produtor, declarações sindicais, contrato de arrendamento);
- Acesso ao Meu INSS (o lead informa apenas o que for necessário no atendimento humano; nunca peça senha pelo WhatsApp).'),

  ('Como a assessoria atua', 'institucional',
'Somos uma assessoria especializada em salário-maternidade. Nosso trabalho:
1. Análise gratuita do caso e do histórico de contribuições;
2. Verificação de carência, qualidade de segurada e melhor caminho para o pedido;
3. Organização e conferência dos documentos;
4. Protocolo do requerimento no INSS e acompanhamento até a decisão;
5. Orientação em caso de exigência ou indeferimento, incluindo recurso.
Condições comerciais, honorários e contrato são tratados sempre por um consultor humano.'),

  ('Motivos comuns de indeferimento', 'faq',
'- Perda da qualidade de segurada (fora do período de graça);
- Carência insuficiente para MEI, autônoma ou facultativa;
- Falta de comprovação de atividade rural;
- Documentação incompleta ou divergência de dados no CNIS;
- Pedido feito na categoria errada.
Em caso de indeferimento é possível apresentar recurso ou refazer o pedido corrigindo a causa.'),

  ('Perguntas frequentes', 'faq',
'"Posso pedir mesmo já tendo passado meses do parto?" Sim, em regra há prazo de até 5 anos.
"Estou desempregada, tenho direito?" Pode ter, se ainda estiver no período de graça.
"Sou MEI, quantos meses preciso pagar?" Em regra 10 contribuições mensais.
"Recebo Bolsa Família, posso receber também?" São benefícios diferentes; a análise é feita caso a caso.
"O benefício é garantido?" Não. Quem decide é o INSS; nós preparamos o pedido da melhor forma possível.
Sempre que a dúvida envolver valores, prazos do seu caso, contrato ou pagamento, o atendimento é passado para um consultor humano.')
)
INSERT INTO public.knowledge_base (company_id, title, category, content, status, metadata)
SELECT c.id, a.title, a.category::public.knowledge_category, a.content, 'ACTIVE'::public.content_status,
       jsonb_build_object('seed', 'salario-maternidade')
FROM public.companies c
CROSS JOIN artigos a
WHERE NOT EXISTS (
  SELECT 1 FROM public.knowledge_base k WHERE k.company_id = c.id AND k.title = a.title
);
