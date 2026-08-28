// readingOrders.js — guias de leitura sugeridos, conteúdo curado estático
// (não vem de nenhuma API). São sugestões gerais e conhecidas entre leitores,
// não uma lista oficial. Cada passo é só um título — o botão de pesquisa
// pré-preenche o Descobrir para o utilizador encontrar e adicionar ele mesmo,
// para não assumirmos IDs de catálogo que podíamos errar.

export const READING_ORDERS = [
  {
    id: "mcu-comics-start",
    title: { pt: "BD do Universo Marvel — por onde começar", en: "Marvel Cinematic comics — where to start" },
    description: {
      pt: "Sagas independentes, sem precisares de ler décadas de continuidade.",
      en: "Self-contained sagas, no need to read decades of continuity.",
    },
    steps: [
      "Iron Man: Extremis",
      "Captain America: Winter Soldier",
      "Civil War",
      "Secret Invasion",
      "Infinity Gauntlet",
    ],
  },
  {
    id: "batman-essentials",
    title: { pt: "Batman — sagas essenciais", en: "Batman — essential sagas" },
    description: {
      pt: "As histórias mais recomendadas para quem quer começar por Gotham.",
      en: "The most recommended stories for starting out in Gotham.",
    },
    steps: ["Batman: Year One", "The Killing Joke", "Batman: Hush", "The Dark Knight Returns", "The Long Halloween"],
  },
  {
    id: "shonen-classics",
    title: { pt: "Manga shonen — clássicos para começar", en: "Shonen manga — classics to start with" },
    description: {
      pt: "Séries longas e muito populares, boas portas de entrada ao género.",
      en: "Long-running, hugely popular series — good entry points to the genre.",
    },
    steps: ["One Piece", "My Hero Academia", "Jujutsu Kaisen", "Demon Slayer"],
  },
];
