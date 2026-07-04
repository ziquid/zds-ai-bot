import { Command } from 'commander';
import { loadMCPConfig } from '../mcp/config.js';
import { getMCPManager } from '../grok/tools.js';
import chalk from 'chalk';

export function createMCPCommand(): Command {
  const mcpCommand = new Command('mcp');
  mcpCommand.description('Inspect configured MCP (Model Context Protocol) servers (config is read-only; edit bot-mcp.json directly to add/remove servers)');

  // List servers command
  mcpCommand
    .command('list')
    .description('List configured MCP servers')
    .action(async () => {
      const config = loadMCPConfig();
      const manager = getMCPManager();
      
      if (config.servers.length === 0) {
        console.log(chalk.yellow('No MCP servers configured'));
        return;
      }

      console.log(chalk.bold('Configured MCP servers:'));
      console.log();

      for (const server of config.servers) {
        const isConnected = manager.getServers().includes(server.name);
        const status = isConnected 
          ? chalk.green('✓ Connected') 
          : chalk.red('✗ Disconnected');
        
        console.log(`${chalk.bold(server.name)}: ${status}`);
        
        // Display transport information
        if (server.transport) {
          console.log(`  Transport: ${server.transport.type}`);
          if (server.transport.type === 'stdio') {
            console.log(`  Command: ${server.transport.command} ${(server.transport.args || []).join(' ')}`);
          } else if (server.transport.type === 'http' || server.transport.type === 'sse') {
            console.log(`  URL: ${server.transport.url}`);
          }
        } else if (server.command) {
          // Legacy format
          console.log(`  Command: ${server.command} ${(server.args || []).join(' ')}`);
        }
        
        if (isConnected) {
          const transportType = manager.getTransportType(server.name);
          if (transportType) {
            console.log(`  Active Transport: ${transportType}`);
          }

          const tools = (await manager.getTools()).filter(t => t.serverName === server.name);
          console.log(`  Tools: ${tools.length}`);
          if (tools.length > 0) {
            tools.forEach(tool => {
              const displayName = tool.name.replace(`mcp__${server.name}__`, '');
              console.log(`    - ${displayName}: ${tool.description}`);
            });
          }
        }
        
        console.log();
      }
    });

  // Test server command
  mcpCommand
    .command('test <name>')
    .description('Test connection to an MCP server')
    .action(async (name: string) => {
      try {
        const config = loadMCPConfig();
        const serverConfig = config.servers.find(s => s.name === name);
        
        if (!serverConfig) {
          console.error(chalk.red(`Server ${name} not found`));
          process.exit(1);
        }

        console.log(chalk.blue(`Testing connection to ${name}...`));

        const manager = getMCPManager();
        await manager.addServer(serverConfig);

        const tools = (await manager.getTools()).filter(t => t.serverName === name);
        console.log(chalk.green(`✓ Successfully connected to ${name}`));
        console.log(chalk.blue(`  Available tools: ${tools.length}`));
        
        if (tools.length > 0) {
          console.log('  Tools:');
          tools.forEach(tool => {
            const displayName = tool.name.replace(`mcp__${name}__`, '');
            console.log(`    - ${displayName}: ${tool.description}`);
          });
        }

      } catch (error: any) {
        console.error(chalk.red(`✗ Failed to connect to ${name}: ${error.message}`));
        process.exit(1);
      }
    });

  return mcpCommand;
}
