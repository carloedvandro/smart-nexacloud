# Conversas completas: áudio, mídia e mensagens enviadas pelo celular

Três lacunas confirmadas no código atual:

1. **Mídia não aparece no sistema.** O webhook até baixa e guarda o arquivo no storage (`ingest.server.ts` → bucket `conversation-media`), mas a tela de conversas nunca exibe: a bolha da mensagem só imprime texto e mostra "(mídia)" quando não há conteúdo. Não existe geração de link assinado para o arquivo salvo.
2. **Não dá para enviar áudio/mídia pelo sistema.** A integração com o WhatsApp só tem `sendText`. Não há envio de áudio, imagem ou documento.
3. **O que é escrito no celular (WhatsApp tronco) não entra no sistema.** O processamento descarta explicitamente as mensagens `fromMe`, então tudo que o atendente digita direto no aparelho fica fora do histórico.

## O que será feito

### 1. Receber e ouvir mídia
- Corrigir o download de mídia para cobrir os formatos que a MEGA API devolve (base64 ou URL) e registrar erro visível quando falhar, em vez de salvar a mensagem sem arquivo.
- Criar uma função de servidor que devolve um link assinado temporário do arquivo, respeitando a empresa do usuário.
- Na tela de conversas, renderizar por tipo:
  - áudio: player nativo (ouvir na hora)
  - imagem: miniatura com abertura ampliada
  - vídeo: player
  - documento: link para baixar com nome/tipo
- Mostrar estado "mídia indisponível" quando o arquivo não foi baixado.

### 2. Transcrição de áudio recebido
- Ao chegar um áudio, transcrever automaticamente e gravar em `messages.transcription` (campo já existe, junto com `transcription_status`).
- Exibir a transcrição abaixo do player e usá-la como texto de entrada da IA, para que o atendente virtual entenda áudios.

### 3. Enviar áudio e mídia pelo sistema
- Adicionar envio de mídia na integração (áudio/imagem/documento) usando os endpoints de mídia da MEGA API.
- No chat: botão de gravar áudio (gravação direta pelo navegador) e botão de anexo para imagem/documento.
- O arquivo é salvo no storage da empresa, registrado como mensagem e enviado ao lead pelo número tronco, com o mesmo controle de status de entrega das mensagens de texto.
- A ponte com o consultor continua igual: quando o consultor mandar áudio pelo WhatsApp dele, o áudio é espelhado ao lead e fica registrado no sistema.

### 4. Registrar mensagens enviadas pelo próprio celular
- Passar a gravar as mensagens `fromMe` que não vieram do sistema, como mensagem do atendente na conversa correspondente, em vez de descartá-las.
- Mensagens que o próprio sistema enviou continuam sendo apenas atualizadas de status (sem duplicar), usando o identificador externo já guardado.
- Assim o histórico da conversa fica completo, independentemente de onde a resposta foi escrita.

## Detalhes técnicos

- `src/lib/whatsapp/ingest.server.ts`: ramo `fromMe` passa a fazer fallback para `ingest_inbound_message` com `sender_type = 'consultant'` quando o `external_message_id` não existir na base; `downloadAndStoreMedia` ganha suporte a resposta por URL e log de falha.
- Nova RPC/ajuste em SQL para inserir mensagem de saída originada no aparelho sem quebrar contadores de não lidas.
- `src/lib/whatsapp/mega.server.ts`: `sendMedia` (base64) para audio/image/document/video.
- `src/lib/whatsapp/whatsapp.functions.ts`: server function de upload + envio e de link assinado.
- `src/routes/_authenticated/conversas.tsx`: `MessageBubble` por `message_type`, gravador de áudio via `MediaRecorder`, input de arquivo.
- Transcrição via Lovable AI (áudio → texto) disparada no ingest, com `transcription_status` refletindo o andamento.
