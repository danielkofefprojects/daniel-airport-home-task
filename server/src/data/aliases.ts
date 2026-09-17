export const REGION_ALIASES: Record<string, string[]> = {
  "new england": ["ME", "NH", "VT", "MA", "RI", "CT"],
  "pacific northwest": ["WA", "OR"],
  "bay area": ["CA"],
  "southern california": ["CA"],
  "midwest": ["OH", "IN", "IL", "MI", "WI", "MN", "IA", "MO", "ND", "SD", "NE", "KS"],
  "mid-atlantic": ["NY", "NJ", "PA", "DE", "MD", "VA", "WV"]
};

export const CITY_ALIASES: Record<string, string[]> = {
  la: ["LAX"],
  "los angeles": ["LAX"],
  "santa ana": ["SNA"],
  "orange county": ["SNA"],
  "bay area": ["SFO", "OAK", "SJC"],
  "san francisco bay area": ["SFO", "OAK", "SJC"],
  chicago: ["ORD", "MDW"],
  "new york": ["JFK", "LGA", "EWR"],
  nyc: ["JFK", "LGA", "EWR"],
  boston: ["BOS"],
  anchorage: ["ANC"],
  "washington dc": ["DCA", "IAD", "BWI"],
  dc: ["DCA", "IAD", "BWI"]
};
