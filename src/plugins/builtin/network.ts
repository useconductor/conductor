import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import dns from 'dns/promises';

export class NetworkPlugin implements Plugin {
  name = 'network';
  description = 'DNS lookup, IP geolocation, public IP, port checking';
  version = '1.0.0';

  async initialize(_conductor: Conductor): Promise<void> {}
  isConfigured(): boolean {
    return true;
  }

  getTools(): PluginTool[] {
    return [
      {
        name: 'dns_lookup',
        description: 'Look up DNS records for a domain',
        inputSchema: {
          type: 'object',
          properties: {
            domain: { type: 'string', description: 'Domain to look up (e.g. google.com)' },
            type: { type: 'string', description: 'Record type: A, AAAA, MX, TXT, NS, CNAME, SOA', default: 'A' },
          },
          required: ['domain'],
        },
        handler: async (input: { domain: string; type?: string }) => {
          const t = (input.type || 'A').toUpperCase();
          try {
            switch (t) {
              case 'A':
                return { domain: input.domain, type: t, records: await dns.resolve4(input.domain) };
              case 'AAAA':
                return { domain: input.domain, type: t, records: await dns.resolve6(input.domain) };
              case 'MX':
                return { domain: input.domain, type: t, records: await dns.resolveMx(input.domain) };
              case 'TXT':
                return { domain: input.domain, type: t, records: await dns.resolveTxt(input.domain) };
              case 'NS':
                return { domain: input.domain, type: t, records: await dns.resolveNs(input.domain) };
              case 'CNAME':
                return { domain: input.domain, type: t, records: await dns.resolveCname(input.domain) };
              case 'SOA':
                return { domain: input.domain, type: t, records: await dns.resolveSoa(input.domain) };
              default:
                throw new Error(`Unsupported record type: ${t}`);
            }
          } catch (e: any) {
            return { domain: input.domain, type: t, error: e.code || e.message };
          }
        },
      },
      {
        name: 'ip_info',
        description: 'Get geolocation and ISP info for an IP address (or your public IP)',
        inputSchema: {
          type: 'object',
          properties: {
            ip: { type: 'string', description: 'IP address (leave empty for your public IP)' },
          },
        },
        handler: async (input: { ip?: string }) => {
          const target = input.ip || '';
          const res = await fetch(
            `http://ip-api.com/json/${target}?fields=status,message,country,regionName,city,zip,lat,lon,timezone,isp,org,as,query`,
          );
          return await res.json();
        },
      },
      {
        name: 'reverse_dns',
        description: 'Reverse DNS lookup — find hostnames for an IP address',
        inputSchema: {
          type: 'object',
          properties: {
            ip: { type: 'string', description: 'IP address to look up' },
          },
          required: ['ip'],
        },
        handler: async (input: { ip: string }) => {
          try {
            const hostnames = await dns.reverse(input.ip);
            return { ip: input.ip, hostnames };
          } catch (e: any) {
            return { ip: input.ip, hostnames: [], error: e.code || e.message };
          }
        },
      },
    ];
  }
}
