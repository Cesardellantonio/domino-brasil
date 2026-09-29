# 🁫 Dominó de Dupla

Dominó de dupla do jeito brasileiro, no navegador. Pra jogar com a família pela internet, contra bots, ou os dois, conversando por voz como na mesa do boteco. Funciona no celular e no computador, sem instalar nada e sem criar conta.

**▶ Jogar:** https://cesardellantonio.github.io/domino-brasil/

## O que tem

- **Regras brasileiras.** 28 pedras, parceiro sentado à frente, e a carroça de sena (6-6) abre a primeira mão.
- **Corrida até 100 (padrão).** A cada mão, a dupla que **perde** soma no próprio placar os pontos das pedras que ficaram na mão dela. Joga-se mão atrás de mão, e **quem chegar a 100 perde** (limite de 50, 150 ou 200 também). Jogo trancado: vence a dupla com a menor soma. Empate: a próxima mão vale dobro. Vencer sem levar nenhum ponto é buchuda.
- **Pontuação por batida (opcional).** Quem bate marca: simples 1, carroça 2, lá-e-lô 3, cruzada 4. Vence quem chegar a 6.
- **Modos.** Duplas (2×2), cada um por si (4), 3 jogadores e 1 contra 1 (com compra no monte).
- **Mesa online.** Crie a mesa, mande o link no WhatsApp e a família entra com um toque. Lugar vazio vira bot, e dá pra escolher quem faz dupla com quem.
- **📞 Chamada de voz da mesa.** Todo mundo conversa enquanto joga, com microfone mudo e indicador de quem está falando.
- **💬 Conversa.** Frases prontas ("Passou! 😂", "Segura essa!", "Desce mais uma gelada! 🍺") ou texto livre.
- **Bots em três níveis.**
  - *Fácil* joga quase aleatório.
  - *Médio* joga como um bom jogador de clube: descarta pedras pesadas e carroças, lembra quem passou em qual número e joga nos números do parceiro.
  - *Difícil* simula centenas de mãos possíveis, compatíveis com tudo que já foi visto, e joga cada lance até o fim.
  - No torneio de teste, o Médio vence o Fácil em 91% e o Difícil vence o Médio em 75%.
- **Dicas.** 💡 pergunta ao bot Difícil qual seria a jogada.
- **Contagem clara de pedras.** Cada jogador mostra suas pedras viradas e um número grande, que fica vermelho com 2 ou menos.
- **Som.** Todo sintetizado, sem arquivos: estalo da pedra na mesa, a pancada da batida com todas as pedras pulando, embaralhar, "toc-toc" de quem passa, e um ambiente de boteco opcional com burburinho e copo batendo.
- **Memória.** Mostra os números em que cada um já passou (dá pra desligar).
- **Histórico.** Vitórias, e retrospecto de parceria e rivalidade por pessoa.
- **Aparência.** Três mesas (feltro, madeira de boteco, noite), e dá pra instalar como app (PWA).

## Como funciona o jogo online

Não existe servidor próprio. O navegador de quem **cria a mesa** é o anfitrião: ele embaralha (com `crypto.getRandomValues`), valida todas as jogadas, roda os bots e manda para cada jogador **só as pedras dele**.

As mensagens do jogo passam por um "carteiro" MQTT público via WebSocket seguro (HiveMQ, com EMQX de reserva). Isso funciona em qualquer rede, inclusive dados móveis, porque não depende de conexão direta entre os aparelhos. O canal é um hash do código da mesa e todo o conteúdo vai **cifrado de ponta a ponta** (AES-GCM, com chave derivada do código), então o servidor público só vê bytes embaralhados.

A **chamada de voz** é direta entre os aparelhos (WebRTC via PeerJS). Em redes mais fechadas ela precisa de um servidor TURN, que pode ser configurado no build com `VITE_TURN_URLS`, `VITE_TURN_USERNAME` e `VITE_TURN_CREDENTIAL`.

➡️ **O anfitrião deve deixar a aba aberta** durante a partida. Se ele recarregar, a mesa volta de onde parou e todos reconectam. Se alguém cair, um bot joga no lugar dele depois de 40 segundos, até ele voltar.

## Desenvolvimento

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # regras, mesa e torneio de bots (~1 min)
npm run arena      # só o torneio de bots
npm run build
```

```
src/engine   regras puras: distribuição, jogadas válidas, pontuação, visão de cada jogador
src/bots     dedução, amostragem de mãos, bots heurístico e Monte Carlo
src/net      Room (anfitrião), transporte PeerJS, chamada de voz em malha
src/ui       interface React: mesa, layout em cobrinha, lobby, telas
scripts/     testes visuais com Chrome headless (partida, online, voz)
```

Cada push na `main` roda os testes e publica no GitHub Pages.
