/**
 * Sample local preview content. Keep empty in production so all titles and ratings
 * come from the configured API. The home page never invents titles or rating data.
 *
 * Title shape: { id, title, type, creator: { displayName, slug }, synopsis,
 * thumbnailUrl, bannerUrl, videoUrl, rating, ratingCount, createdAt, access }
 */
export const titles = [
    {
        id: "test1", 
        title: "NOVA 2084",
        type: "Placeholder",
        creator: { displayName: "NOVA 2084"},
        synopsis: "The Visionary Is Watching You.",
        thumbnailUrl: "https://animocha.com/assets/img/placeholder/NOVA-84-sketch-promo1.png",
        bannerUrl: "https://animocha.com/assets/img/placeholder/iris-glb.PNG",
        videoUrl: "https://literally2084.github.io/real/resources/v.mp4",
        rating: "0",
        ratingCount: "0",
        createdAt: "1/1/84",
        access: "free_no_ads"
    }
];
