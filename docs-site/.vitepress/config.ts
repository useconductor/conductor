import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Conductor',
  description: 'The AI Tool Hub — One MCP server. 100+ tools. Every AI agent.',
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Docs', link: '/getting-started' },
      { text: 'API Reference', link: '/api' },
      { text: 'Plugins', link: '/plugins' },
      { text: 'SDKs', link: '/sdks' },
      { text: 'Changelog', link: '/changelog' },
    ],
    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Quick Start', link: '/getting-started' },
          { text: 'Configuration', link: '/configuration' },
          { text: 'CLI Reference', link: '/cli' },
        ],
      },
      {
        text: 'Core',
        items: [
          { text: 'MCP Server', link: '/mcp' },
          { text: 'Plugin Development', link: '/plugins' },
          { text: 'Webhook System', link: '/webhooks' },
          { text: 'Security & Audit', link: '/security' },
        ],
      },
      {
        text: 'SDKs',
        items: [
          { text: 'Overview', link: '/sdks' },
          { text: 'TypeScript', link: '/sdks/typescript' },
          { text: 'Python', link: '/sdks/python' },
          { text: 'Go', link: '/sdks/go' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'API Reference', link: '/api' },
          { text: 'Changelog', link: '/changelog' },
          { text: 'Contributing', link: '/contributing' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/conductor/conductor' },
    ],
    footer: {
      message: 'Released under the Apache 2.0 License.',
      copyright: 'Copyright © 2026 Conductor Team',
    },
  },
})
