# Nexa Leads

# PROJETO: NEXAATENDE

Estamos iniciando oficialmente o desenvolvimento de um sistema SaaS próprio chamado:

NEXAATENDE

Slogan:

"Atendimento inteligente. Leads nunca mais sem resposta."

IMPORTANTE:

Este é um projeto real de produção contratado por uma empresa.

Não quero um protótipo visual, mockup ou demonstração.

Quero construir uma aplicação funcional, segura, escalável e preparada para produção.

O sistema será desenvolvido integralmente no Lovable.

O backend, banco de dados, autenticação, storage, realtime e funções backend deverão utilizar os recursos do próprio Lovable Cloud.

NÃO criar um banco externo.

NÃO conectar um Supabase externo.

NÃO utilizar Chatwoot.

NÃO utilizar outro CRM como backend.

O banco de dados oficial do projeto será o PostgreSQL disponibilizado pelo Lovable Cloud.

O Lovable Cloud possui infraestrutura baseada no ecossistema Supabase, portanto utilizar corretamente os recursos disponíveis de PostgreSQL, Auth, Storage, Realtime, Edge Functions e demais recursos nativos.

==================================================

1. CONTEXTO DO PRODUTO

==================================================

O cliente é uma associação que comercializa/revende planos de saúde de diferentes empresas/operadoras.

O principal problema do cliente é atendimento.

Atualmente existem situações em que leads chegam através de anúncios, principalmente Facebook e Instagram, entram em contato pelo WhatsApp e acabam ficando sem atendimento ou esperando tempo demais.

O NexaAtende deverá resolver isso através de:

- Inteligência Artificial;

- atendimento humanizado;

- memória de clientes;

- CRM;

- central de conversas;

- WhatsApp;

- pré-qualificação;

- distribuição automática;

- rodízio entre consultores;

- SLA de atendimento;

- transferência automática quando o consultor não responde;

- painel administrativo;

- acompanhamento em tempo real;

- histórico completo.

O primeiro contato será realizado pela IA.

A IA deverá conversar com o cliente, entender sua necessidade, coletar informações preliminares e posteriormente encaminhar o lead para um consultor humano.

Existirão inicialmente 7 consultores.

O sistema NÃO deve ser codificado pensando somente em 7 consultores.

O número deverá ser configurável e poderá crescer.

==================================================

2. ARQUITETURA PRINCIPAL

==================================================

Arquitetura conceitual:

Cliente

↓

Facebook / Instagram / outros canais

↓

WhatsApp

↓

MEGA API

↓

Webhook

↓

NEXAATENDE

↓

IA / CRM / Fila / Memória

↓

PostgreSQL

↓

Realtime

↓

Painel administrativo / Consultor

O sistema deverá ser construído de maneira modular.

Separar claramente:

Frontend

Backend

Banco

Integrações

IA

Regras de negócio

Autenticação

Realtime

Storage

Logs

Não colocar regras críticas de negócio apenas no frontend.

==================================================

3. PRINCÍPIO FUNDAMENTAL

==================================================

O PostgreSQL do Lovable Cloud será a fonte principal dos dados do sistema.

Toda informação importante deverá ser persistida.

Isso inclui:

- leads;

- clientes;

- conversas;

- mensagens;

- áudios;

- transcrições;

- memória;

- resumos;

- consultores;

- atribuições;

- transferências;

- fila;

- timeouts;

- logs;

- configurações;

- conexões WhatsApp;

- consentimentos LGPD;

- ações administrativas.

O sistema deverá conseguir reconstruir o histórico de um atendimento utilizando seus próprios dados.

Não depender exclusivamente da MEGA API para armazenar histórico.

==================================================

4. MULTI-TENANT

==================================================

Embora inicialmente exista apenas uma empresa, a arquitetura deverá ser preparada para multi-tenant.

Criar entidade:

companies

Todos os dados empresariais deverão estar relacionados à empresa.

Exemplo:

company_id

Deverá existir isolamento lógico entre empresas.

Um usuário de uma empresa nunca poderá consultar dados de outra empresa.

Não criar uma arquitetura rígida em uma única empresa.

==================================================

5. ENTIDADES PRINCIPAIS

==================================================

Criar inicialmente uma arquitetura de banco contemplando, no mínimo:

companies

users

roles

user_roles

leads

lead_memory

lead_notes

conversations

messages

conversation_assignments

assignment_attempts

conversation_events

whatsapp_connections

whatsapp_events

ai_sessions

ai_summaries

knowledge_base

business_hours

queue_settings

audit_logs

privacy_consents

system_settings

A modelagem poderá ser aprimorada caso exista uma estrutura tecnicamente superior, mas não eliminar essas responsabilidades.

==================================================

6. EMPRESA

==================================================

Tabela:

companies

Campos mínimos:

id

name

legal_name

document

email

phone

address

city

state

status

created_at

updated_at

Preparar para configurações futuras.

==================================================

7. USUÁRIOS

==================================================

Utilizar autenticação do próprio Lovable Cloud.

Não criar sistema de senha manual.

Utilizar o mecanismo de autenticação disponível no Cloud.

Criar relação entre usuário autenticado e:

company_id

role

Perfis:

ADMIN

CONSULTANT

Preparar arquitetura para novos perfis futuros.

==================================================

8. ADMINISTRADOR

==================================================

ADMIN poderá:

- visualizar todos os leads;

- visualizar todas as conversas;

- acompanhar conversas em tempo real;

- assumir conversas;

- transferir conversas;

- cadastrar consultores;

- ativar/desativar consultores;

- gerenciar WhatsApps;

- configurar horários;

- configurar fila;

- configurar SLA;

- visualizar logs;

- configurar IA;

- gerenciar base de conhecimento;

- visualizar indicadores;

- gerenciar configurações.

==================================================

9. CONSULTOR

==================================================

CONSULTANT poderá:

- visualizar seus atendimentos;

- responder clientes;

- visualizar histórico;

- visualizar informações coletadas pela IA;

- visualizar resumo e memória do lead;

- assumir atendimento atribuído;

- encerrar atendimento.

Não poderá acessar configurações administrativas.

==================================================

10. LEADS

==================================================

Tabela:

leads

Campos mínimos:

id

company_id

name

phone

whatsapp

email

city

source

status

assigned_user_id

created_at

updated_at

first_contact_at

last_interaction_at

qualified_at

closed_at

metadata

metadata poderá utilizar JSONB para informações dinâmicas.

Exemplos:

dependentes

tipo_plano

faixa_preco

cidade

preferencias

necessidades

Criar índices para:

company_id

phone

whatsapp

status

assigned_user_id

created_at

==================================================

11. ORIGEM DO LEAD

==================================================

O sistema deverá permitir registrar:

facebook

instagram

whatsapp

site

indicacao

outro

Preparar também:

utm_source

utm_medium

utm_campaign

utm_content

campaign_id

ad_id

Mesmo que alguns recursos sejam utilizados somente posteriormente.

==================================================

12. CONVERSAS

==================================================

Tabela:

conversations

Campos:

id

company_id

lead_id

channel

channel_id

assigned_user_id

status

started_at

last_message_at

closed_at

created_at

updated_at

Status iniciais:

AI_ACTIVE

WAITING_HUMAN

QUEUED

ASSIGNED

HUMAN_ACTIVE

WAITING_CUSTOMER

CLOSED

PAUSED

Não espalhar strings de status aleatoriamente pelo código.

Centralizar os estados.

==================================================

13. MENSAGENS

==================================================

Tabela:

messages

Campos:

id

company_id

conversation_id

external_message_id

sender_type

sender_id

sender_name

message_type

content

media_url

mime_type

transcription

metadata

created_at

sender_type:

customer

ai

consultant

admin

system

message_type:

text

audio

image

document

video

system

other

Preparar estrutura para futuras mídias.

==================================================

14. IDEMPOTÊNCIA

==================================================

Muito importante.

A MEGA API trabalhará com webhooks.

Um mesmo webhook poderá ser recebido mais de uma vez.

Nunca criar mensagens duplicadas.

Utilizar:

external_message_id

Criar constraint ou mecanismo equivalente para impedir duplicação.

Se uma mensagem já existir:

não criar novamente.

==================================================

15. MEMÓRIA DO LEAD

==================================================

Criar tabela:

lead_memory

A memória deverá ser separada do histórico bruto.

Exemplo:

Cliente:

João Silva

Memória:

Cidade:

Guarulhos

Quantidade de pessoas:

4

Tipo de plano:

Familiar

Faixa de orçamento:

R$ 400–600

Preferência:

Enfermaria

A memória deverá conter somente informações relevantes e persistentes.

Não colocar todo o histórico bruto dentro da memória.

==================================================

16. RESUMO DA CONVERSA

==================================================

Criar estrutura para resumo.

Exemplo:

"Cliente procura plano familiar para quatro pessoas, possui orçamento aproximado de R$ 500 e deseja comparar cobertura e preço."

O resumo deverá ser atualizado pela IA.

O histórico completo continuará na tabela messages.

==================================================

17. CONHECIMENTO DA IA

==================================================

Criar:

knowledge_base

Campos:

id

company_id

title

category

content

status

created_at

updated_at

Categorias:

planos

operadoras

precos

coberturas

carencias

faq

processos

institucional

outros

A IA deverá utilizar essa base.

REGRA ABSOLUTA:

A IA nunca deve inventar:

- preço;

- cobertura;

- carência;

- operadora;

- benefício;

- regra comercial.

Quando não houver informação confiável:

encaminhar para humano.

Preparar arquitetura para futura busca semântica/RAG.

==================================================

18. WHATSAPP

==================================================

Criar tabela:

whatsapp_connections

Campos:

id

company_id

user_id

provider

instance_id

phone_number

status

qr_code_status

last_connected_at

last_disconnected_at

metadata

created_at

updated_at

O consultor não deve ser identificado permanentemente pelo número.

O número é uma conexão.

O consultor é uma entidade separada.

Isso permitirá trocar o WhatsApp sem perder histórico.

==================================================

19. MEGA API

==================================================

A integração será feita com MEGA API.

Não espalhar chamadas da API pelo sistema.

Criar camada de serviço:

WhatsAppService

ou:

MegaApiService

Centralizar:

createInstance

getStatus

getQrCode

connect

disconnect

sendText

sendAudio

sendMedia

logout

Os nomes reais deverão ser adaptados à documentação disponível da MEGA API.

Não inventar endpoints.

Antes de implementar endpoints específicos, analisar a documentação fornecida/configurada para a MEGA API.

==================================================

20. WEBHOOK

==================================================

Criar endpoint backend para receber eventos da MEGA API.

Fluxo:

Webhook

↓

validar requisição

↓

identificar conexão

↓

identificar empresa

↓

identificar telefone

↓

localizar/criar lead

↓

localizar/criar conversa

↓

verificar idempotência

↓

salvar mensagem

↓

atualizar conversa

↓

Realtime

↓

processar IA

Não manter o webhook bloqueado esperando operações longas.

Operações pesadas deverão utilizar processamento assíncrono quando possível.

==================================================

21. REALTIME

==================================================

Utilizar o realtime disponível no Lovable Cloud.

Quando nova mensagem chegar:

MEGA API

↓

Backend

↓

Database

↓

Realtime

↓

Painel

A conversa deverá atualizar automaticamente.

Também atualizar em realtime:

- novas conversas;

- transferência;

- atribuição;

- timeout;

- mudança de status;

- conexão WhatsApp;

- presença do consultor.

==================================================

22. FILA

==================================================

Criar serviço de negócio:

QueueService

A fila não pode depender do navegador.

Se todos os navegadores forem fechados:

a fila continuará funcionando.

A fila será persistida no banco.

==================================================

23. RODÍZIO

==================================================

Inicialmente:

7 consultores.

Mas o sistema deve aceitar:

7

10

20

50

100+

O rodízio deverá ser persistido.

Não utilizar somente variável local.

Criar configuração:

queue_settings

Pode conter:

distribution_mode

round_robin_position

sla_seconds

only_online

business_hours_enabled

==================================================

24. DISPONIBILIDADE

==================================================

Consultores poderão possuir:

ONLINE

OFFLINE

PAUSED

BUSY

Inicialmente:

ONLINE = pode receber

OFFLINE = não recebe

PAUSED = não recebe

Preparar para regras mais avançadas.

==================================================

25. ATRIBUIÇÃO

==================================================

Criar:

conversation_assignments

e:

assignment_attempts

Uma tentativa deverá registrar:

conversation_id

consultant_id

assigned_at

deadline_at

responded_at

status

Status:

WAITING

RESPONDED

TIMEOUT

CANCELLED

==================================================

26. SLA

==================================================

SLA inicial:

60 segundos.

Quando atribuir:

assigned_at = agora

deadline_at = agora + 60 segundos

O consultor deverá enviar uma mensagem efetiva dentro desse prazo.

==================================================

27. TIMEOUT

==================================================

Se não houver resposta:

WAITING

↓

TIMEOUT

↓

registrar evento

↓

liberar atendimento

↓

selecionar próximo consultor

↓

nova atribuição

↓

novo prazo de 60 segundos

Isso deverá funcionar no backend.

NÃO utilizar apenas:

setTimeout()

no frontend.

==================================================

28. CONCORRÊNCIA

==================================================

Cenário:

O consultor responde exatamente quando o timeout está sendo processado.

O sistema deverá impedir dupla transição.

A tentativa deve terminar em apenas um estado:

RESPONDED

OU

TIMEOUT

Nunca os dois.

Utilizar transação, lock ou mecanismo equivalente adequado ao PostgreSQL.

==================================================

29. ADMINISTRADOR ASSUMINDO

==================================================

Se ADMIN assumir:

a conversa deixa de ser controlada pela IA.

A atribuição deverá ser registrada.

Criar evento:

ADMIN_TAKEOVER

==================================================

30. HORÁRIO DE ATENDIMENTO

==================================================

Criar:

business_hours

Permitir:

segunda a domingo

horário inicial

horário final

ativo/inativo

Fora do horário:

IA continua podendo atender.

O lead será preparado para atendimento humano posterior.

==================================================

31. LGPD

==================================================

Criar:

privacy_consents

Registrar:

id

company_id

lead_id

consent_type

version

accepted

accepted_at

metadata

Preparar:

Política de Privacidade

Termos de Uso

Termo de Compromisso

aceite

versão do documento

data/hora

A empresa será responsável pelo conteúdo jurídico.

O sistema será responsável pela implementação técnica.

==================================================

32. AUDITORIA

==================================================

Criar:

audit_logs

Registrar:

LOGIN

LOGOUT

CREATE_LEAD

UPDATE_LEAD

ASSIGN_CONVERSATION

TRANSFER_CONVERSATION

TIMEOUT

SEND_MESSAGE

TAKEOVER

CLOSE_CONVERSATION

CONNECT_WHATSAPP

DISCONNECT_WHATSAPP

UPDATE_USER

UPDATE_SETTINGS

Campos:

company_id

user_id

action

entity_type

entity_id

metadata

created_at

==================================================

33. STORAGE

==================================================

Utilizar Storage do próprio Lovable Cloud para arquivos quando necessário.

Áudios e arquivos privados não devem ser públicos por padrão.

No banco salvar referências aos arquivos.

Não armazenar arquivos binários grandes diretamente no PostgreSQL.

==================================================

34. SEGURANÇA

==================================================

Implementar segurança desde o início.

Obrigatório:

Authentication

Authorization

RBAC

Company isolation

RLS/policies adequadas

Proteção de rotas

Validação de inputs

Proteção contra acesso indevido

Secrets no backend

Webhooks protegidos

Auditoria

Nunca colocar API keys no frontend.

Nunca colocar secrets diretamente no código.

Utilizar Secrets do Lovable Cloud.

==================================================

35. ÍNDICES

==================================================

Criar índices adequados para:

company_id

lead_id

conversation_id

assigned_user_id

phone

whatsapp

external_message_id

status

created_at

last_message_at

Pensar em performance desde o início.

==================================================

36. PAGINAÇÃO

==================================================

Nunca carregar milhares de:

mensagens

leads

conversas

logs

de uma única vez.

Implementar paginação.

==================================================

37. FRONTEND INICIAL

==================================================

Criar estrutura profissional.

Sidebar:

Dashboard

Conversas

Leads

Consultores

WhatsApp

Conhecimento IA

Fila

Relatórios

Configurações

Não precisa desenvolver todas as telas agora.

Criar arquitetura de navegação preparada.

==================================================

38. DASHBOARD

==================================================

Preparar dashboard para:

Leads hoje

Conversas abertas

IA atendendo

Aguardando consultor

Consultores online

Transferências

Timeouts

Tempo médio de primeira resposta

==================================================

39. DESIGN

==================================================

Visual:

profissional

moderno

limpo

SaaS

responsivo

Não quero aparência de template genérico.

Nome:

NexaAtende

Slogan:

Atendimento inteligente. Leads nunca mais sem resposta.

==================================================

40. O QUE NÃO FAZER AGORA

==================================================

Não implementar neste primeiro passo:

financeiro

comissões

gestão financeira

estoque

ERP contábil

emissão fiscal

folha

contabilidade

O produto atual é:

CRM + Atendimento + WhatsApp + IA.

A arquitetura deverá permitir expansão futura.

==================================================

41. ORDEM DE IMPLEMENTAÇÃO

==================================================

Nesta primeira execução NÃO tente construir todo o sistema.

Primeiro faça somente:

1. Configuração do Lovable Cloud

2. Estrutura do banco

3. Tabelas

4. Relacionamentos

5. Índices

6. Authentication

7. Roles

8. RLS/políticas

9. Estrutura base do frontend

10. Layout principal

11. Sidebar

12. Rotas protegidas

13. Dashboard inicial

14. Estrutura para Realtime

15. Estrutura para Edge Functions

16. Estrutura de Secrets

Não implementar ainda a integração completa da MEGA API.

Não implementar ainda a IA completa.

Não implementar ainda o motor de fila completo.

Primeiro quero uma fundação sólida.

==================================================

42. MIGRATIONS

==================================================

Todas as alterações estruturais do banco devem ser feitas de forma organizada e reproduzível.

Não fazer alterações manuais inconsistentes.

Sempre que criar ou alterar tabela:

- revisar foreign keys;

- revisar índices;

- revisar RLS;

- revisar permissões;

- revisar tipos;

- revisar impacto nas relações.

==================================================

43. VERIFICAÇÃO FINAL DESTA ETAPA

==================================================

Antes de concluir esta primeira etapa, verificar:

[ ] Lovable Cloud ativo

[ ] PostgreSQL funcionando

[ ] Authentication funcionando

[ ] Roles funcionando

[ ] Multi-tenant preparado

[ ] Tabelas criadas

[ ] Foreign keys criadas

[ ] Índices criados

[ ] RLS/policies configuradas

[ ] Storage preparado

[ ] Edge Functions preparado

[ ] Secrets preparado

[ ] Layout principal funcionando

[ ] Rotas protegidas

[ ] Dashboard inicial

[ ] Realtime preparado

[ ] Nenhum secret exposto

[ ] Nenhuma API externa falsa

[ ] Nenhum dado de produção fictício

[ ] Nenhuma regra crítica implementada somente no frontend

==================================================

44. REGRA FINAL

==================================================

Não tente simplificar o projeto removendo funcionalidades importantes.

Porém, também não tente implementar funcionalidades futuras antes da fundação.

Nesta etapa, o objetivo é construir uma BASE DE PRODUÇÃO sólida.

Depois dessa etapa, vamos implementar o sistema em módulos:

FASE 2:

Autenticação + usuários + consultores

FASE 3:

CRM + leads + conversas

FASE 4:

MEGA API + WhatsApp + Webhooks

FASE 5:

IA + áudio + memória + conhecimento

FASE 6:

Fila + rodízio + SLA + timeout

FASE 7:

Dashboard + supervisão + relatórios

FASE 8:

LGPD + auditoria + segurança avançada

FASE 9:

Testes completos e preparação para produção

Não avance automaticamente para as próximas fases.

Primeiro conclua e valide a fundação.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://smart-nexacloud.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/a2ec8d42-9fce-40a5-b0ba-d92efed63ad7).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
