import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';

export class FunPlugin implements Plugin {
  name = 'fun';
  description = 'Jokes, cat facts, trivia, random numbers, and more';
  version = '1.0.0';

  async initialize(_conductor: Conductor): Promise<void> {}
  isConfigured(): boolean {
    return true;
  }

  getTools(): PluginTool[] {
    return [
      {
        name: 'fun_joke',
        description: 'Get a random joke',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const res = await fetch('https://official-joke-api.appspot.com/random_joke');
          return await res.json();
        },
      },
      {
        name: 'fun_cat_fact',
        description: 'Get a random cat fact',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const res = await fetch('https://catfact.ninja/fact');
          return await res.json();
        },
      },
      {
        name: 'fun_trivia',
        description: 'Get a random trivia question',
        inputSchema: {
          type: 'object',
          properties: {
            difficulty: { type: 'string', description: 'easy, medium, or hard', default: 'medium' },
          },
        },
        handler: async (input: { difficulty?: string }) => {
          const diff = input.difficulty || 'medium';
          const res = await fetch(`https://opentdb.com/api.php?amount=1&difficulty=${diff}&type=multiple`);
          const data = (await res.json()) as any;
          if (!data.results?.length) return { error: 'No trivia found' };
          const q = data.results[0];
          const answers = [...q.incorrect_answers, q.correct_answer].sort(() => Math.random() - 0.5);
          return {
            category: q.category,
            difficulty: q.difficulty,
            question: q.question.replace(/&[^;]+;/g, (m: string) => {
              const map: Record<string, string> = {
                '&amp;': '&',
                '&lt;': '<',
                '&gt;': '>',
                '&quot;': '"',
                '&#039;': "'",
              };
              return map[m] || m;
            }),
            answers,
            correct: q.correct_answer,
          };
        },
      },
      {
        name: 'fun_random_number',
        description: 'Generate a random number in a range',
        inputSchema: {
          type: 'object',
          properties: {
            min: { type: 'number', description: 'Minimum value', default: 1 },
            max: { type: 'number', description: 'Maximum value', default: 100 },
          },
        },
        handler: async (input: { min?: number; max?: number }) => {
          const min = input.min ?? 1;
          const max = input.max ?? 100;
          return { min, max, result: Math.floor(Math.random() * (max - min + 1)) + min };
        },
      },
      {
        name: 'fun_quote',
        description: 'Get an inspirational quote',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          // Built-in quotes — zero latency, no dead API dependencies
          const quotes = [
            { quote: 'The best way to predict the future is to create it.', author: 'Peter Drucker' },
            { quote: "Code is like humor. When you have to explain it, it's bad.", author: 'Cory House' },
            { quote: 'First, solve the problem. Then, write the code.', author: 'John Johnson' },
            {
              quote:
                'Any fool can write code that a computer can understand. Good programmers write code that humans can understand.',
              author: 'Martin Fowler',
            },
            {
              quote: 'Programs must be written for people to read, and only incidentally for machines to execute.',
              author: 'Harold Abelson',
            },
            { quote: 'Simplicity is the soul of efficiency.', author: 'Austin Freeman' },
            { quote: 'Make it work, make it right, make it fast.', author: 'Kent Beck' },
            { quote: 'Talk is cheap. Show me the code.', author: 'Linus Torvalds' },
            { quote: 'In order to be irreplaceable, one must always be different.', author: 'Coco Chanel' },
            { quote: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
            { quote: "It always seems impossible until it's done.", author: 'Nelson Mandela' },
            { quote: "Whether you think you can or you think you can't, you're right.", author: 'Henry Ford' },
            { quote: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
            { quote: 'Stay hungry, stay foolish.', author: 'Steve Jobs' },
          ];
          return quotes[Math.floor(Math.random() * quotes.length)];
        },
      },
    ];
  }
}
