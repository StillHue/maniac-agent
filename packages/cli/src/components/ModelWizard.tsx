import React, { useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  PROVIDER_DEFS,
  PROVIDER_ENV_KEY,
  fetchModels,
  loadManiacConfig,
  saveManiacConfig,
  setActiveProvider,
  upsertRegisteredSlot,
  type ManiacConfig,
  type ProviderDef,
} from '@maniac/engine';

type WizardStep = 'menu' | 'provider' | 'apikey' | 'baseurl' | 'models';

interface ModelWizardProps {
  onDone: (msg: string) => void;
  onCancel: () => void;
  isFirstBoot?: boolean;
}

const AUTO_ENTRY = {
  id: 'auto',
  name: 'Auto (roteia só os providers que você cadastrou)',
  requiresKey: false,
  baseUrl: '',
  modelsEndpoint: '',
  chatEndpoint: '',
  authType: 'none' as const,
  format: 'openai' as const,
};
const WIZARD_PROVIDERS = [AUTO_ENTRY, ...PROVIDER_DEFS.filter((d) => d.id !== 'auto')];

/** Only reuse a stored key when it belongs to the same provider. */
function resolveKey(providerId: string, typed: string, existingKey?: string): string {
  if (typed.trim()) return typed.trim();
  if (existingKey?.trim()) return existingKey.trim();
  const envVar = PROVIDER_ENV_KEY[providerId];
  if (envVar && process.env[envVar]) return process.env[envVar]!;
  return '';
}

function providerIndex(id: string): number {
  return WIZARD_PROVIDERS.findIndex((p) => p.id === id);
}

export function ModelWizard({ onDone, onCancel, isFirstBoot }: ModelWizardProps) {
  const existing = useMemo(() => loadManiacConfig(), []);
  const hasExisting =
    !isFirstBoot &&
    !!existing?.provider &&
    existing.provider !== '';

  const [step, setStep] = useState<WizardStep>(hasExisting ? 'menu' : 'provider');
  const [menuIdx, setMenuIdx] = useState(0);
  const [providerIdx, setProviderIdx] = useState(() => {
    const i = existing?.provider ? providerIndex(existing.provider) : -1;
    return i >= 0 ? i : 0;
  });
  // Credentials are scoped to the currently selected provider — never seed across providers.
  const [apiKey, setApiKey] = useState(() =>
    existing?.provider && providerIndex(existing.provider) >= 0 ? existing.apiKey || '' : '',
  );
  const [baseUrl, setBaseUrl] = useState(() =>
    existing?.provider && providerIndex(existing.provider) >= 0 ? existing.baseUrl || '' : '',
  );
  const [inputValue, setInputValue] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [modelIdx, setModelIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const loadSeq = useRef(0);

  const selectedDef = WIZARD_PROVIDERS[providerIdx];

  const menuItems = [
    { id: 'model', label: `Change model only  (${existing?.provider || '—'} / ${existing?.model || '—'})` },
    { id: 'provider', label: 'Change provider' },
    { id: 'auto', label: 'Use Auto router' },
  ] as const;

  function keyFor(providerId: string, typed = ''): string {
    const same = existing?.provider === providerId;
    return resolveKey(providerId, typed || (same ? apiKey : ''), same ? existing?.apiKey : undefined);
  }

  function urlFor(providerId: string, def: { baseUrl?: string }, typed = ''): string {
    const same = existing?.provider === providerId;
    if (typed.trim()) return typed.trim();
    if (same && (baseUrl || existing?.baseUrl)) return baseUrl || existing!.baseUrl || '';
    return def.baseUrl || '';
  }

  async function loadModels(def: ProviderDef, key: string, bUrl: string) {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError('');
    try {
      const list = await fetchModels(def, key, bUrl || undefined);
      if (seq !== loadSeq.current) return;
      setModels(list);
      const current = existing?.model;
      const idx = current ? list.indexOf(current) : -1;
      setModelIdx(idx >= 0 ? idx : 0);
    } catch (e: any) {
      if (seq !== loadSeq.current) return;
      setError(e.message);
      setModels([]);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }

  function goToModelsFor(def: (typeof WIZARD_PROVIDERS)[number], typedKey = '', typedUrl = '') {
    if (def.id === 'auto') {
      const slots = existing?.autoSlots || [];
      if (!slots.length) {
        setError('Cadastre um provider+modelo antes de usar Auto (escolha qualquer provider na lista).');
        setStep(hasExisting ? 'menu' : 'provider');
        return;
      }
      saveManiacConfig({
        provider: 'auto',
        model: 'auto',
        apiKey: '',
        temperature: existing?.temperature ?? 0.3,
        maxTokens: existing?.maxTokens ?? 4096,
        autoSlots: slots,
      });
      setActiveProvider({ provider: 'auto', model: 'auto' });
      onDone(`provider: Auto  (${slots.length} cadastrado${slots.length === 1 ? '' : 's'})`);
      return;
    }
    const url = urlFor(def.id, def, typedUrl);
    if (def.id === 'custom' && !url) {
      setInputValue('');
      setStep('baseurl');
      return;
    }

    const key = keyFor(def.id, typedKey);

    // Skip API key prompt when we already have one for THIS provider (config or .env)
    if (def.requiresKey && !key) {
      setInputValue('');
      setStep('apikey');
      return;
    }

    setApiKey(key);
    setBaseUrl(url);
    setStep('models');
    void loadModels(def as ProviderDef, key, url);
  }

  function selectProvider(def: (typeof WIZARD_PROVIDERS)[number]) {
    const same = existing?.provider === def.id;
    if (!same) {
      // Do not carry credentials/URL from a different provider
      setApiKey('');
      setBaseUrl(def.baseUrl || '');
    }
    goToModelsFor(def);
  }

  function goBack() {
    setError('');
    if (step === 'models') {
      if (selectedDef.requiresKey && !keyFor(selectedDef.id)) {
        setStep('apikey');
      } else if (hasExisting) {
        setStep('menu');
      } else {
        setStep('provider');
      }
      return;
    }
    if (step === 'apikey') {
      if (selectedDef.id === 'custom') setStep('baseurl');
      else if (hasExisting) setStep('menu');
      else setStep('provider');
      return;
    }
    if (step === 'baseurl') {
      if (hasExisting) setStep('menu');
      else setStep('provider');
      return;
    }
    if (step === 'provider' && hasExisting) {
      setStep('menu');
      return;
    }
    onCancel();
  }

  useInput((char, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.leftArrow || (char === 'b' && step !== 'apikey' && step !== 'baseurl')) {
      goBack();
      return;
    }

    if (step === 'menu') {
      if (key.upArrow) {
        setMenuIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setMenuIdx((i) => Math.min(menuItems.length - 1, i + 1));
        return;
      }
      if (key.return) {
        const choice = menuItems[menuIdx].id;
        if (choice === 'auto') {
          goToModelsFor(AUTO_ENTRY);
          return;
        }
        if (choice === 'provider') {
          setStep('provider');
          return;
        }
        // change model only — keep current provider; never fall back to Auto
        const idx = existing?.provider ? providerIndex(existing.provider) : -1;
        if (idx < 0) {
          setError(
            `Provider "${existing?.provider || '?'}" isn't listed here — choose Change provider`,
          );
          setStep('provider');
          return;
        }
        setProviderIdx(idx);
        goToModelsFor(WIZARD_PROVIDERS[idx]);
        return;
      }
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
        selectProvider(selectedDef);
        return;
      }
    }

    if (step === 'apikey') {
      if (key.return) {
        const key_ = inputValue.trim();
        setApiKey(key_);
        setInputValue('');
        goToModelsFor(selectedDef, key_, baseUrl);
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
        const key = keyFor('custom', apiKey);
        if (!key && selectedDef.requiresKey) {
          setStep('apikey');
        } else {
          goToModelsFor(selectedDef, key, url);
        }
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
        setModelIdx((i) => Math.min(Math.max(0, models.length - 1), i + 1));
        return;
      }
      if (key.return && models.length > 0) {
        const chosenModel = models[modelIdx];
        const key = keyFor(selectedDef.id, apiKey);
        const url = urlFor(selectedDef.id, selectedDef, baseUrl);
        // Register this provider+model for Auto failover; stay on the chosen model now.
        const autoSlots = upsertRegisteredSlot(existing?.autoSlots, {
          provider: selectedDef.id,
          model: chosenModel,
          apiKey: key,
          baseUrl: url || undefined,
        });
        const cfg: ManiacConfig = {
          provider: selectedDef.id,
          model: chosenModel,
          apiKey: key,
          baseUrl: url || undefined,
          temperature: existing?.temperature ?? 0.3,
          maxTokens: existing?.maxTokens ?? 4096,
          autoSlots,
        };
        saveManiacConfig(cfg);
        setActiveProvider({ provider: cfg.provider, model: cfg.model });
        onDone(`provider: ${selectedDef.name}  model: ${chosenModel}`);
        return;
      }
    }
  });

  const PAGE = 12;
  const pageStart = Math.max(0, modelIdx - Math.floor(PAGE / 2));
  const pageEnd = Math.min(models.length, pageStart + PAGE);
  const envHint = PROVIDER_ENV_KEY[selectedDef.id];
  const hasResolvedKey = !!keyFor(selectedDef.id);

  return (
    <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
      {isFirstBoot ? (
        <Text>
          welcome to maniac <Text dimColor>— pick a provider to get started</Text>
        </Text>
      ) : (
        <Text dimColor>── model setup  (ESC cancel · ← back) ──────────────</Text>
      )}
      <Text> </Text>

      {step === 'menu' && (
        <Box flexDirection="column">
          <Text dimColor>
            current: {existing?.provider || '—'} / {existing?.model || '—'}
          </Text>
          {error ? <Text color="red">{error}</Text> : null}
          <Text> </Text>
          {menuItems.map((item, i) => (
            <Box key={item.id}>
              <Text color={i === menuIdx ? 'white' : undefined} dimColor={i !== menuIdx}>
                {i === menuIdx ? '› ' : '  '}
                {item.label}
              </Text>
            </Box>
          ))}
          <Text> </Text>
          <Text dimColor>↑/↓ navigate  · enter select  · ← back</Text>
        </Box>
      )}

      {step === 'provider' && (
        <Box flexDirection="column">
          <Text dimColor>select provider:</Text>
          {error ? <Text color="red">{error}</Text> : null}
          {WIZARD_PROVIDERS.map((def, i) => (
            <Box key={def.id}>
              <Text color={i === providerIdx ? 'white' : undefined} dimColor={i !== providerIdx}>
                {i === providerIdx ? '› ' : '  '}
                {def.name}
              </Text>
            </Box>
          ))}
          <Text> </Text>
          <Text dimColor>↑/↓ navigate  · enter select  · ← back</Text>
        </Box>
      )}

      {step === 'baseurl' && (
        <Box flexDirection="column">
          <Text dimColor>base URL (e.g. http://localhost:11434/v1):</Text>
          <Box paddingTop={1}>
            <Text dimColor>{'> '}</Text>
            <Text>{inputValue}█</Text>
          </Box>
          <Text dimColor>enter confirm  · ← back</Text>
        </Box>
      )}

      {step === 'apikey' && (
        <Box flexDirection="column">
          <Text dimColor>API key for {selectedDef.name}:</Text>
          {envHint ? (
            <Text dimColor>
              {hasResolvedKey
                ? `(using existing key from config / ${envHint})`
                : `(or set ${envHint} in .env)`}
            </Text>
          ) : null}
          <Box paddingTop={1}>
            <Text dimColor>{'> '}</Text>
            <Text dimColor>{'*'.repeat(inputValue.length)}█</Text>
          </Box>
          <Box paddingTop={1}>
            <Text dimColor>enter confirm  · leave empty to use env/config  · ← back</Text>
          </Box>
        </Box>
      )}

      {step === 'models' && (
        <Box flexDirection="column">
          <Text dimColor>
            provider: {selectedDef.name}
            {hasResolvedKey ? '  ·  key ok' : ''}
          </Text>
          {loading && <Text dimColor>fetching models...</Text>}
          {error && (
            <Box flexDirection="column">
              <Text color="red">error: {error}</Text>
              <Text dimColor>← back to fix provider/key</Text>
            </Box>
          )}
          {!loading && !error && models.length === 0 && (
            <Text dimColor>no models found  · ← back</Text>
          )}
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
              <Text dimColor>↑/↓ navigate  · enter select  · ← back</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
