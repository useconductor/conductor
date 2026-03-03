import { Conductor } from '../../core/conductor.js';
import { AIManager } from '../../ai/manager.js';

export async function setupAI(conductor: Conductor): Promise<void> {
  await conductor.initialize();

  const { default: inquirer } = await import('inquirer');

  const { provider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'Select an AI provider:',
      choices: [
        { name: 'Claude (Anthropic)', value: 'claude' },
        { name: 'OpenAI (GPT-4o)', value: 'openai' },
        { name: 'OpenRouter', value: 'openrouter' },
        { name: 'Gemini (Google)', value: 'gemini' },
        { name: 'Ollama (Local)', value: 'ollama' },
      ],
    },
  ]);

  const aiManager = new AIManager(conductor);

  switch (provider) {
    case 'claude': {
      const { apiKey } = await inquirer.prompt([
        {
          type: 'password',
          name: 'apiKey',
          message: 'Enter your Anthropic API key:',
          mask: '*',
        },
      ]);
      await aiManager.setupClaude(apiKey);
      console.log('✅ Claude configured successfully.');
      break;
    }
    case 'openai': {
      const { apiKey } = await inquirer.prompt([
        {
          type: 'password',
          name: 'apiKey',
          message: 'Enter your OpenAI API key:',
          mask: '*',
        },
      ]);
      await aiManager.setupOpenAI(apiKey);
      console.log('✅ OpenAI configured successfully.');
      break;
    }
    case 'openrouter': {
      const { apiKey } = await inquirer.prompt([
        {
          type: 'password',
          name: 'apiKey',
          message: 'Enter your OpenRouter API key:',
          mask: '*',
        },
      ]);

      // Fetch available models from OpenRouter using the provided key
      let modelChoices: { name: string; value: string }[] = [];
      try {
        process.stdout.write('Fetching available models from OpenRouter...');
        const res = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (res.ok) {
          const json = await res.json() as { data: { id: string; name: string }[] };
          modelChoices = json.data
            .sort((a: { id: string; name: string }, b: { id: string; name: string }) => a.id.localeCompare(b.id))
            .map((m: { id: string; name: string }) => ({ name: `${m.name} (${m.id})`, value: m.id }));
          process.stdout.write(` ${modelChoices.length} models found.\n`);
        }
      } catch {
        // silently fall through to manual entry
      }

      let model: string;
      if (modelChoices.length > 0) {
        const answer = await inquirer.prompt([
          {
            type: 'select',
            name: 'model',
            message: 'Select a model:',
            choices: modelChoices,
            pageSize: 15,
          },
        ]);
        model = answer.model;
      } else {
        console.log('Could not fetch model list. Please enter a model ID manually.');
        const answer = await inquirer.prompt([
          {
            type: 'input',
            name: 'model',
            message: 'Model ID (e.g. openai/gpt-4o, anthropic/claude-3.5-sonnet):',
            default: 'openai/gpt-4o',
          },
        ]);
        model = answer.model;
      }

      await aiManager.setupOpenRouter(apiKey, model);
      console.log(`\u2705 OpenRouter configured successfully with ${model}.`);
      break;
    }
    case 'gemini': {
      const { method } = await inquirer.prompt([
        {
          type: 'list',
          name: 'method',
          message: 'How would you like to authenticate?',
          choices: [
            { name: 'Google Sign-In (easiest)', value: 'oauth' },
            { name: 'API Key', value: 'api_key' },
          ],
        },
      ]);

      if (method === 'oauth') {
        console.log('Opening browser for Google Sign-In...');
        await aiManager.setupGeminiOAuthEasy();
        console.log('✅ Gemini configured with Google Sign-In.');
      } else {
        const { apiKey } = await inquirer.prompt([
          {
            type: 'password',
            name: 'apiKey',
            message: 'Enter your Gemini API key:',
            mask: '*',
          },
        ]);
        await aiManager.setupGemini(apiKey);
        console.log('✅ Gemini configured successfully.');
      }
      break;
    }
    case 'ollama': {
      const { model } = await inquirer.prompt([
        {
          type: 'input',
          name: 'model',
          message: 'Which Ollama model?',
          default: 'llama3.2',
        },
      ]);
      await aiManager.setupOllama(model);
      console.log(`✅ Ollama configured with ${model}.`);
      break;
    }
  }
}

export async function testAI(conductor: Conductor): Promise<void> {
  await conductor.initialize();
  const aiManager = new AIManager(conductor);

  const provider = await aiManager.getCurrentProvider();
  if (!provider) {
    console.log('No AI provider configured. Run: conductor ai setup');
    return;
  }

  console.log(`Testing ${provider.getName()}...`);
  const works = await provider.test();
  console.log(works ? '✅ AI provider is working.' : '❌ AI provider test failed.');
}
