// TikTok Creative Center industries.
// IDs were fetched live from
//   GET https://ads.tiktok.com/creative_radar_api/v1/popular_trend/hashtag/filters
// on 2026-05-04. The 18-industry taxonomy has been stable since 2024; if TikTok
// adds a new industry, the auto-mapper will simply not return it until this
// constant is refreshed.
//
// Each `description` is a 1-2 sentence prose summary that the embedding mapper
// compares against pillar names + descriptions. Tuned for distinctness — the
// goal is to make each industry's vector clearly different from its neighbors,
// not to be exhaustive.

export type TikTokIndustry = {
    id: string;
    name: string;
    description: string;
};

export const TIKTOK_INDUSTRIES: TikTokIndustry[] = [
    {
        id: '10000000000',
        name: 'Education',
        description: 'Learning, study tips, school, college, courses, languages, productivity for students, science explainers, how-to and educational content.',
    },
    {
        id: '11000000000',
        name: 'Vehicle & Transportation',
        description: 'Cars, motorcycles, trucks, EVs, automotive reviews, road trips, driving, mechanics, car culture and modifications.',
    },
    {
        id: '12000000000',
        name: 'Baby, Kids & Maternity',
        description: 'Parenting, pregnancy, babies, toddlers, kids, motherhood, fatherhood, family life, child development.',
    },
    {
        id: '13000000000',
        name: 'Financial Services',
        description: 'Personal finance, investing, stocks, crypto, real estate, taxes, retirement, budgeting, money management and wealth building.',
    },
    {
        id: '14000000000',
        name: 'Beauty & Personal Care',
        description: 'Makeup, skincare, haircare, grooming, beauty routines, cosmetics, perfume, nails and self-care rituals.',
    },
    {
        id: '15000000000',
        name: 'Tech & Electronics',
        description: 'Gadgets, smartphones, computers, software, AI, apps, programming, tech reviews and consumer electronics.',
    },
    {
        id: '17000000000',
        name: 'Travel',
        description: 'Travel destinations, vacations, hotels, flights, backpacking, road trips, expat life, tourism and adventure travel.',
    },
    {
        id: '18000000000',
        name: 'Household Products',
        description: 'Cleaning, organization, home essentials, household hacks, laundry, kitchen tools and everyday domestic life.',
    },
    {
        id: '19000000000',
        name: 'Pets',
        description: 'Dogs, cats, pets, pet care, training, animal rescue, vets and pet lifestyle content.',
    },
    {
        id: '21000000000',
        name: 'Home Improvement',
        description: 'DIY, renovation, interior design, home decor, gardening, woodworking, real estate flipping and home projects.',
    },
    {
        id: '22000000000',
        name: 'Apparel & Accessories',
        description: 'Fashion, clothing, outfits, style, streetwear, shoes, jewelry, bags and personal style content.',
    },
    {
        id: '23000000000',
        name: 'News & Entertainment',
        description: 'Pop culture, celebrity news, comedy, memes, music, film, TV, sports drama and general entertainment commentary.',
    },
    {
        id: '24000000000',
        name: 'Business Services',
        description: 'Entrepreneurship, business strategy, marketing, sales, productivity, leadership, B2B, startups and professional career advice.',
    },
    {
        id: '25000000000',
        name: 'Games',
        description: 'Video games, mobile games, gaming reviews, esports, streamers, gaming culture, board games and game development.',
    },
    {
        id: '26000000000',
        name: 'Life Services',
        description: 'Local services, lifestyle improvements, dating, relationships, self-development, mental health and everyday life advice.',
    },
    {
        id: '27000000000',
        name: 'Food & Beverage',
        description: 'Cooking, recipes, restaurants, food reviews, baking, dining, drinks, meal prep and culinary content.',
    },
    {
        id: '28000000000',
        name: 'Sports & Outdoor',
        description: 'Sports, hiking, camping, outdoor adventure, athletic training, team sports, extreme sports and outdoor gear.',
    },
    {
        id: '29000000000',
        name: 'Health',
        description: 'Fitness, gym, workouts, nutrition, weight loss, mental health, medical, wellness and physical wellbeing.',
    },
];

export function getIndustryById(id: string | null | undefined): TikTokIndustry | null {
    if (!id) return null;
    return TIKTOK_INDUSTRIES.find(i => i.id === id) ?? null;
}
