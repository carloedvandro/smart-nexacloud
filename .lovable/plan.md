# Corrigir atribuição de lead no Kanban (e sincronizar status em todo o sistema)

## O que está acontecendo

Verifiquei o código do Kanban e as funções do banco:

1. **Atribuir responsável no card só grava o dono do lead.** A função `assign_lead` atualiza apenas `leads.assigned_user_id`. Ela não muda o status do lead, não atribui a conversa ao consultor e não dispara o aviso no WhatsApp. Por isso o card continua parado em "Novo" e nada muda em Conversas/Fila.
2. **Super administrador operando em outra empresa não consegue alterar nada.** `assign_lead` e `set_lead_status` usam `current_company_id()` (a empresa do próprio usuário logado) no `WHERE`. Quando você usa o seletor de empresa do Kanban e mexe num lead de outra empresa, a atualização não encontra a linha e a função lança "lead inexistente" — a tela parece simplesmente não reagir.
3. **Arrastar o card entre colunas também não propaga.** `set_lead_status` muda só o lead; a conversa aberta continua com o status antigo, então Conversas, Fila e Dashboard mostram informação divergente.
4. **Leads duplicados (a investigar).** Nas telas aparece o mesmo contato (Cacá, `80809860063277@lid`) em dois cards diferentes. Isso indica que a entrada por `@lid` e a entrada por número podem estar criando dois leads para a mesma pessoa. Preciso conferir os dados antes de afirmar a causa — será o primeiro passo da execução.

## O que vou fazer

### 1. Atribuir responsável = colocar em atendimento (de verdade)
Ao escolher um consultor no card do Kanban, o sistema passará a, numa única ação:
- definir o responsável do lead;
- mover o lead para "Em atendimento" (e devolver para "Aguardando consultor" quando o responsável for removido);
- atribuir a conversa aberta desse lead ao mesmo consultor;
- avisar o consultor no WhatsApp pessoal, igual à atribuição feita na tela de Conversas;
- encerrar ofertas de rodízio pendentes daquele lead, para não haver duas atribuições concorrentes.

### 2. Arrastar entre colunas sincroniza a conversa
Mudança de etapa no Kanban passa a refletir na conversa aberta (em atendimento, aguardando cliente, encerrada em Ganho/Perdido), para que Conversas, Fila, Kanban e Dashboard mostrem sempre o mesmo estado.

### 3. Super administrador pode operar qualquer empresa
As funções de atribuição e mudança de status passam a aceitar a empresa do próprio lead quando quem chama é PLATFORM_ADMIN, mantendo a restrição atual para administradores e consultores da empresa.

### 4. Erros deixam de ser silenciosos
Qualquer falha nessas ações aparecerá como aviso na tela, com mensagem clara, em vez de o card simplesmente não se mexer.

### 5. Duplicidade de leads
Depois de conferir os dados, unifico o lead por identidade do WhatsApp para que o mesmo contato não gere dois cards. Se a checagem mostrar outra causa, aviso antes de mudar.

## Detalhes técnicos

- Migração: novas versões de `assign_lead` e `set_lead_status` resolvendo a empresa a partir do próprio lead quando `is_platform_admin()`, e nova função `assign_lead_and_service(_lead_id, _consultant_id)` que executa atribuição do lead + status + `assign_conversation` na conversa aberta e cancela `assignment_attempts` em `WAITING`. GRANT EXECUTE para `authenticated`.
- Nova server function em `src/lib/queue/assign.functions.ts` (ou arquivo irmão) chamando a RPC e reaproveitando `notifyManualAssignment` para o aviso no WhatsApp.
- `src/lib/nexa/crm.ts`: `assignLead` passa a usar a nova função; nova helper para status sincronizado.
- `src/routes/_authenticated/kanban.tsx`: mutations `changeOwner`/`moveLead` apontando para as novas funções, com atualização otimista e invalidação de `kanban-leads`, `conversations` e `leads`.
- Verificação dos duplicados por consulta aos leads da empresa antes de qualquer mudança de ingestão.
