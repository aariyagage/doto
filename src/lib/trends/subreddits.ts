// Curated subreddit catalog for the Reddit fallback trend source.
//
// Used when a pillar's TikTok industry mapping confidence is too low to be
// useful (essay/commentary/productivity/mindset niches). Each subreddit has a
// prose description that the embedding mapper compares against pillar
// names + descriptions.
//
// Curation rules:
// - Long-running, active subs (100k+ subscribers) — short-lived ones go stale
// - Discussion-driven (text posts > image posts) so titles are useful as
//   trend signals
// - Skip subs with heavy NSFW or hostile cultures — anchor titles surface
//   in creator UI
// - Categories are for human reference; the mapper doesn't use them

export type Subreddit = {
    name: string;          // without r/ prefix, case as listed on Reddit
    description: string;   // 1-2 sentences for embedding match
    category: string;      // for human reference only
};

export const SUBREDDITS: Subreddit[] = [
    // Productivity / discipline
    {
        name: 'productivity',
        description: 'Time management, focus, getting things done, calendar systems, deep work, and the daily mechanics of being effective.',
        category: 'productivity',
    },
    {
        name: 'getdisciplined',
        description: 'Self-discipline, habits, breaking through procrastination, building consistency, willpower and follow-through.',
        category: 'productivity',
    },
    {
        name: 'decidingtobebetter',
        description: 'Self-improvement journeys, identity shifts, deciding to change, the gap between knowing and doing.',
        category: 'productivity',
    },

    // Mindset / philosophy / self
    {
        name: 'Stoicism',
        description: 'Stoic philosophy applied to modern life — control, virtue, resilience, dealing with adversity, ancient wisdom for modern problems.',
        category: 'mindset',
    },
    {
        name: 'selfimprovement',
        description: 'Personal growth, becoming a better version of yourself, mindset shifts, life advice and reflection.',
        category: 'mindset',
    },
    {
        name: 'getmotivated',
        description: 'Motivation, inspiration, mental toughness, pep talks, comeback stories.',
        category: 'mindset',
    },

    // Social / cultural commentary
    {
        name: 'changemyview',
        description: 'Polite debate about contested opinions, cultural takes, ethics, politics, ideas — people defending positions they hold.',
        category: 'commentary',
    },
    {
        name: 'unpopularopinion',
        description: 'Controversial takes on culture, society, food, lifestyle, work — opinions people hold but don\'t say out loud.',
        category: 'commentary',
    },
    {
        name: 'AskReddit',
        description: 'Open-ended cultural questions about life experiences, opinions, behavior, observations — the broad pulse of internet conversation.',
        category: 'commentary',
    },
    {
        name: 'TrueOffMyChest',
        description: 'Personal confessions, raw emotional disclosures, real-life situations people are processing.',
        category: 'commentary',
    },

    // Relationships / life
    {
        name: 'relationships',
        description: 'Romantic relationships, dating, marriage, breakups, communication, conflict, the day-to-day of being with another person.',
        category: 'relationships',
    },
    {
        name: 'AmItheAsshole',
        description: 'Real interpersonal conflict scenarios people are sorting out — friends, family, dating, workplace, neighbors.',
        category: 'relationships',
    },
    {
        name: 'relationship_advice',
        description: 'Practical advice for relationship problems, conflicts, decisions, breakups, communication issues.',
        category: 'relationships',
    },

    // Tech / future / commentary
    {
        name: 'technology',
        description: 'Tech industry news, AI, software, gadgets, regulation, the cultural impact of technology on daily life.',
        category: 'tech',
    },
    {
        name: 'Futurology',
        description: 'Future of work, AI impact, longevity, climate, society, big-picture conversations about where things are heading.',
        category: 'tech',
    },

    // Money / finance
    {
        name: 'personalfinance',
        description: 'Budgeting, debt, saving, investing basics, taxes, salary negotiation, financial decisions in regular people\'s lives.',
        category: 'money',
    },
    {
        name: 'financialindependence',
        description: 'Early retirement, FIRE movement, investing, wealth building, lifestyle design around financial freedom.',
        category: 'money',
    },
    {
        name: 'povertyfinance',
        description: 'Money management at the low end — surviving paycheck to paycheck, food assistance, debt, frugal living, class realities.',
        category: 'money',
    },

    // Fitness / health
    {
        name: 'Fitness',
        description: 'Strength training, cardio, exercise programs, gym culture, workout advice, body composition.',
        category: 'fitness',
    },
    {
        name: 'loseit',
        description: 'Weight loss journeys, calorie counting, sustainable habits, body image, diet experiences.',
        category: 'fitness',
    },

    // Food / cooking
    {
        name: 'cooking',
        description: 'Home cooking, recipes, technique, kitchen tools, meal planning, food experiments.',
        category: 'food',
    },
    {
        name: 'EatCheapAndHealthy',
        description: 'Budget-friendly meals, frugal cooking, healthy eating without spending much, meal prep on a budget.',
        category: 'food',
    },

    // Parenting
    {
        name: 'Parenting',
        description: 'Raising children, family decisions, school, discipline, teen issues, parenting styles and advice.',
        category: 'parenting',
    },
    {
        name: 'beyondthebump',
        description: 'Postpartum life, new motherhood, baby development, identity shifts after having a child.',
        category: 'parenting',
    },

    // Entrepreneurship / business
    {
        name: 'Entrepreneur',
        description: 'Starting and running businesses, small business advice, marketing, sales, founder stories and challenges.',
        category: 'business',
    },
    {
        name: 'startups',
        description: 'Tech startup advice, fundraising, founder challenges, product market fit, scaling, startup ecosystem.',
        category: 'business',
    },

    // Mental health
    {
        name: 'anxiety',
        description: 'Anxiety experiences, coping strategies, panic, social anxiety, mental health daily struggles and progress.',
        category: 'mentalhealth',
    },

    // Internet culture
    {
        name: 'OutOfTheLoop',
        description: 'Explaining trending events, viral moments, internet drama, news context, what people are talking about.',
        category: 'culture',
    },
];

export function getSubreddit(name: string): Subreddit | null {
    const lc = name.toLowerCase();
    return SUBREDDITS.find(s => s.name.toLowerCase() === lc) ?? null;
}
