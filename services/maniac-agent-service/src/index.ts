import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import * as path from 'path';

import { ChatRequest, ChatResponse } from '@maniac/types';
import { classifyRequest } from './router';
import { callGroq, callNorthMini } from './llm';

// Carregar .env da raiz do projeto
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'maniac-agent-service' });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body as ChatRequest;

    // Classify the intent
    const route = await classifyRequest(message);

    let reply = '';
    const conversation = [...history, { role: 'user' as const, content: message }];

    if (route === 'north') {
      reply = await callNorthMini(conversation);
    } else {
      reply = await callGroq(conversation);
    }

    const responseData: ChatResponse = {
      response: reply,
      route
    };
    res.json(responseData);
  } catch (error: any) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

app.listen(port, () => {
  console.log(`Maniac Agent Service running on port ${port}`);
});
