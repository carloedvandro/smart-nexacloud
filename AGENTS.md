<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Verificação e publicação

- `npm run build` valida o bundle; execute também `npx tsc --noEmit` para verificar os tipos.
- `node --test push-notifications.test.cjs` testa a presença do navegador e o filtro de push com dependências simuladas, sem enviar notificações reais. Não substitui a aplicação/teste da migração em PostgreSQL nem o teste no iPhone.
- Neste projeto, o usuário precisou aplicar manualmente migrations recebidas via GitHub. Não afirmar que um push aplicou o SQL; confirmar a aplicação no Lovable Cloud separadamente.
- No iPhone, ativar os avisos dentro do app instalado em Configurações → Perfil → Avisos no celular. Instalar apenas o ícone não concede permissão de push.

