import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from '@react-email/components'

import type { TemplateEntry } from './registry'

interface CompanyInviteProps {
  companyName?: string
  roleLabel?: string
  inviteUrl: string
  expiresAt?: string
}

const CompanyInviteEmail = ({
  companyName,
  roleLabel,
  inviteUrl,
  expiresAt,
}: CompanyInviteProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>
      Seu convite de acesso ao NexaAtende{companyName ? ` — ${companyName}` : ''}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>NexaAtende</Text>
        <Heading style={h1}>Você foi convidado</Heading>
        <Text style={text}>
          Você recebeu um convite para acessar o NexaAtende
          {companyName ? ` da ${companyName}` : ''}
          {roleLabel ? ` como ${roleLabel}` : ''}. Clique no botão abaixo para
          criar seu acesso.
        </Text>
        <Button style={button} href={inviteUrl}>
          Aceitar convite
        </Button>
        <Text style={small}>
          Se o botão não funcionar, copie e cole este endereço no navegador:
          <br />
          {inviteUrl}
        </Text>
        {expiresAt ? (
          <Text style={small}>Este convite expira em {expiresAt}.</Text>
        ) : null}
        <Text style={footer}>
          Atendimento inteligente. Leads nunca mais sem resposta.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: CompanyInviteEmail,
  subject: 'Seu convite de acesso ao NexaAtende',
  displayName: 'Convite de acesso',
  previewData: {
    companyName: 'APSP',
    roleLabel: 'consultor',
    inviteUrl: 'https://nexaatende.yrwentechnology.com.br/convite/exemplo',
    expiresAt: '20/08/2026 18:00',
  },
} satisfies TemplateEntry

export default CompanyInviteEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const brand = {
  fontSize: '13px',
  letterSpacing: '2px',
  textTransform: 'uppercase' as const,
  color: '#1d4ed8',
  fontWeight: 'bold' as const,
  margin: '0 0 12px',
}
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#0f172a',
  margin: '0 0 16px',
}
const text = {
  fontSize: '14px',
  color: '#475569',
  lineHeight: '1.6',
  margin: '0 0 24px',
}
const button = {
  backgroundColor: '#1d4ed8',
  color: '#ffffff',
  fontSize: '14px',
  borderRadius: '8px',
  padding: '12px 22px',
  textDecoration: 'none',
  fontWeight: 'bold' as const,
}
const small = {
  fontSize: '12px',
  color: '#64748b',
  lineHeight: '1.6',
  margin: '24px 0 0',
  wordBreak: 'break-all' as const,
}
const footer = { fontSize: '12px', color: '#94a3b8', margin: '28px 0 0' }
