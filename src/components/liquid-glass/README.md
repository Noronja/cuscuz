# Liquid Glass Component Set — Apple visionOS Style

Conjunto completo de componentes em **React/TypeScript** estilizados com **Tailwind CSS**, inspirado na linguagem visual translúcida do **Apple visionOS**.

## 🔮 Características
- **UI Estilo Vidro**: `bg-white/10` a `bg-white/20`, `backdrop-blur-md`, `shadow-xl`, `rounded-2xl`
- **Bordas Iridescentes**: Degradê de dispersão cromática ciano, fúcsia e índigo (`from-cyan-400/50 via-fuchsia-400/40 to-indigo-400/50`)
- **Microinterações visionOS**:
  - `hover:scale-105 active:scale-95` com transições orgânicas de mola
  - Efeito Ripple com captura dinâmica de coordenadas de clique
  - Efeito Shimmer e cursor spotlight dinâmico simulando rastreamento de olhar/atenção
- **Tipografia**: Fonte Inter consistente com `tracking-[-0.06em]`
- **Suporte Total a Dark/Light Mode**

---

## 📦 Componentes Inclusos

1. **`LiquidGlassNav`**: Barra de navegação flutuante em cápsula de vidro com links ativos, ações rápidas e menu responsivo.
2. **`LiquidGlassToggle`**: Interruptor translúcido com brilho ciano, tamanhos `sm`, `md`, `lg` e micro-indicador interno.
3. **`LiquidGlassCard`**: Cartão de funcionalidades 3D com cursor spotlight interativo, badges e botão de ação.
4. **`LiquidGlassTabs`**: Menu de abas / segmented control com indicador fluido, badges e shimmer.
5. **`LiquidGlassShowcase`**: Demonstração interativa completa integrando todos os componentes com switch de modo claro/escuro.

---

## 🚀 Como Integrar no Lovable

### 1. Importação
```tsx
import {
  LiquidGlassNav,
  LiquidGlassToggle,
  LiquidGlassCard,
  LiquidGlassTabs,
  LiquidGlassShowcase
} from '@/components/liquid-glass';
```

### 2. Exemplo de Uso de Interruptor (Toggle)
```tsx
const [enabled, setEnabled] = useState(true);

<LiquidGlassToggle
  checked={enabled}
  onChange={setEnabled}
  label="Áudio Espacial"
  description="Imersão 3D ativa"
  size="md"
/>
```

### 3. Exemplo de Uso de Cartão (Card)
```tsx
<LiquidGlassCard
  title="Computação Espacial"
  description="Interface translúcida flutuante responsiva ao ambiente."
  tag="Novo"
  actionLabel="Explorar"
  onAction={() => console.log('Clicado')}
/>
```

### 4. Exemplo de Uso de Abas (Tabs)
```tsx
const [active, setActive] = useState('tab1');

<LiquidGlassTabs
  tabs={[
    { id: 'tab1', label: 'Início', badge: '3' },
    { id: 'tab2', label: 'Configurações' },
  ]}
  activeTab={active}
  onChange={setActive}
/>
```
