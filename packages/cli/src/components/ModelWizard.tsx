import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  PROVIDER_DEFS,
  fetchModels,
  saveManiacConfig,
  type ManiacConfig,
  type ProviderDef,
} from '@maniac/engine';

type WizardStep = 'provider' | 'apikey' | 'baseurl' | 'models' | 'done';

interface ModelWizardProps {
  onDone: (msg: string) => void;
  onCancel: () => void;
  isFirstBoot?: boolean;
}

const AUTO_ENTRY = {
  id: 'auto',
  name: 'Auto (NVIDIA + OpenCode — no setup needed)',
  requiresKey: false,
  baseUrl: '',
  modelsEndpoint: '',
  chatEndpoint: '',
  authType: 'none' as const,
  format: 'openai' as const,
};
const WIZARD_PROVIDERS = [AUTO_ENTRY, ...PROVIDER_DEFS.filter((d) => d.id !== 'auto')];

export function ModelWizard({ onDone, onCancel, isFirstBoot }: ModelWizardProps) {
  const [step, setStep] = useState<WizardStep>('provider');
  const [providerIdx, setProviderIdx] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [modelIdx, setModelIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedDef = WIZARD_PROVIDERS[providerIdx];

  useInput((char, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (step === 'provider') {
      if (key.upArrow) {
        setProviderIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setProviderIdx((i) => Math.min(WIZARD_PROVIDERS.length - 1, i + 1));
        return;
      }
      if (key.return) {
        if (selectedDef.id === 'auto') {
          saveManiacConfig({ provider: 'auto', model: 'auto', apiKey: '' });
          onDone('provider: Auto  model: auto');
          return;
        }
        if (selectedDef.id === 'custom') {
          setInputValue('');
          setStep('baseurl');
        } else if (!selectedDef.requiresKey) {
          setInputValue('');
          setStep('models');
          void loadModels(selectedDef as ProviderDef, '', selectedDef.baseUrl);
        } else {
          setInputValue('');
          setStep('apikey');
        }
        return;
      }
    }

    if (step === 'apikey') {
      if (key.return) {
        const key_ = inputValue.trim();
        setApiKey(key_);
        setInputValue('');
        setStep('models');
        void loadModels(selectedDef as ProviderDef, key_, selectedDef.baseUrl);
        return;
      }
      if (key.backspace || key.delete) {
        setInputValue((v) => v.slice(0, -1));
        return;
      }
      if (!key.ctrl && !key.meta && char) setInputValue((v) => v + char);
      return;
    }

    if (step === 'baseurl') {
      if (key.return) {
        const url = inputValue.trim();
        setBaseUrl(url);
        setInputValue('');
        setStep('apikey');
        return;
      }
      if (key.backspace || key.delete) {
        setInputValue((v) => v.slice(0, -1));
        return;
      }
      if (!key.ctrl && !key.meta && char) setInputValue((v) => v + char);
      return;
    }

    if (step === 'models') {
      if (loading) return;
      if (key.upArrow) {
        setModelIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setModelIdx((i) => Math.min(models.length - 1, i + 1));
        return;
      }
      if (key.return && models.length > 0) {
        const chosenModel = models[modelIdx];
        const cfg: ManiacConfig = {
          provider: selectedDef.id,
          model: chosenModel,
          apiKey: apiKey || '',
          baseUrl: baseUrl || undefined,
        };
        saveManiacConfig(cfg);
        onDone(`provider: ${selectedDef.name}  model: ${chosenModel}`);
        return;
      }
    }
  });

  async function loadModels(def: ProviderDef, key: string, bUrl: string) {
    setLoading(true);
    setError('');
    try {
      const list = await fetchModels(def, key, bUrl || undefined);
      setModels(list);
      setModelIdx(0);
    } catch (e: any) {
      setError(e.message);
      setModels([]);
    } finally {
      setLoading(false);
    }
  }

  const PAGE = 12;
  const pageStart = Math.max(0, modelIdx - Math.floor(PAGE / 2));
  const pageEnd = Math.min(models.length, pageStart + PAGE);

  return (
    <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
      {isFirstBoot ? (
        <Text>
          welcome to maniac <Text dimColor>— pick a provider to get started</Text>
        </Text>
      ) : (
        <Text dimColor>── model setup  (ESC to cancel) ───────────────────</Text>
      )}
      <Text> </Text>

      {step === 'provider' && (
        <Box flexDirection="column">
          <Text dimColor>select provider:</Text>
          {WIZARD_PROVIDERS.map((def, i) => (
            <Box key={def.id}>
              <Text color={i === providerIdx ? 'white' : undefined} dimColor={i !== providerIdx}>
                {i === providerIdx ? '› ' : '  '}
                {def.name}
              </Text>
            </Box>
          ))}
          <Text> </Text>
          <Text dimColor>↑/↓ navigate  · enter select</Text>
        </Box>
      )}

      {step === 'baseurl' && (
        <Box flexDirection="column">
          <Text dimColor>base URL (e.g. http://localhost:11434/v1):</Text>
          <Box paddingTop={1}>
            <Text dimColor>{'> '}</Text>
            <Text>{inputValue}█</Text>
          </Box>
        </Box>
      )}

      {step === 'apikey' && (
        <Box flexDirection="column">
          <Text dimColor>API key for {selectedDef.name}:</Text>
          <Box paddingTop={1}>
            <Text dimColor>{'> '}</Text>
            <Text dimColor>{'*'.repeat(inputValue.length)}█</Text>
          </Box>
          <Box paddingTop={1}>
            <Text dimColor>enter to confirm  (leave empty to skip)</Text>
          </Box>
        </Box>
      )}

      {step === 'models' && (
        <Box flexDirection="column">
          {loading && <Text dimColor>fetching models...</Text>}
          {error && <Text dimColor>error: {error}</Text>}
          {!loading && !error && models.length === 0 && <Text dimColor>no models found</Text>}
          {!loading && models.length > 0 && (
            <Box flexDirection="column">
              <Text dimColor>select model  ({models.length} available):</Text>
              {models.slice(pageStart, pageEnd).map((m, i) => {
                const idx = pageStart + i;
                return (
                  <Box key={m}>
                    <Text color={idx === modelIdx ? 'white' : undefined} dimColor={idx !== modelIdx}>
                      {idx === modelIdx ? '› ' : '  '}
                      {m}
                    </Text>
                  </Box>
                );
              })}
              <Text> </Text>
              <Text dimColor>↑/↓ navigate  · enter select</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
