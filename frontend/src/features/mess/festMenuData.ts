/**
 * The fest mess menu — six days, three meals a day, per dietary category.
 *
 * ── Where this came from ────────────────────────────────────────────────────
 * IIT Madras publishes its mess menus as a weekly rotation (four rotation weeks,
 * A-D, per dietary category), mirrored by DigiMess at https://digi-mess.vercel.app.
 * Paradox runs 9-14 June 2026, which is one calendar week — Monday 8 June to
 * Sunday 14 June — so a single rotation week covers the whole fest. Resolving
 * DigiMess's own cycle arithmetic (anchor 2026-04-01 = week A, snapped to its
 * Monday, then +1 week per 7 days) puts every fest day in **rotation week C** of
 * the cycle that starts 2026-04-01. That week is what is transcribed below.
 *
 * Two deliberate departures from the source:
 *
 *  - **Snacks are dropped.** The campus menu serves four sittings; the fest
 *    serves three, and `MealSlot` — the value `POST /mess/{id}/scan` takes — only
 *    knows breakfast, lunch and dinner. A fourth sitting here would be a meal no
 *    swipe could ever be logged against.
 *  - **Emphasis marks are stripped.** The source wraps a few dishes in asterisks
 *    to flag the day's special. Rendering is this app's job, not the data's.
 *
 * Otherwise the dish lists are transcribed as published, including the egg
 * options the veg categories carry — that is what those halls actually serve,
 * and a mess volunteer can edit any of it (see `messMenu.ts`).
 *
 * `common` is the standing accompaniment served at every sitting of that meal,
 * kept as the source's single line rather than split into dishes: the entries
 * carry their own internal commas ("any three of the Cucumber, Tomato, …") and
 * splitting them produces nonsense.
 *
 * Generated from the published data, then frozen here. This is the **starting
 * point**, not the stored menu: a hall's own team publishes theirs through
 * `PUT /mess/{mess_id}/menu`, and `messMenu.ts` lays that over this. A hall that
 * has published nothing serves what is written here.
 *
 * One consequence worth knowing: because a published menu is a full copy rather
 * than a diff, correcting a dish below will **not** reach halls that have already
 * published. Their own record wins, which is the right precedence but does mean
 * edits here are not retroactive.
 */
import type { MealSlot } from '@/api/types';

/** A dietary category as IITM publishes it. Halls map onto these in `messMenu.ts`. */
export type MenuCategory =
  | 'south_veg'
  | 'south_non_veg'
  | 'north_veg'
  | 'north_non_veg'
  | 'north_veg_no_onion_garlic'
  | 'unified_veg'
  | 'unified_non_veg';

/** One fest day's three sittings. */
export interface MenuDay {
  /** ISO date, so a day can be shown as a date and not just "Day 3". */
  date: string;
  weekday: string;
  breakfast: string[];
  lunch: string[];
  dinner: string[];
}

export interface CategoryMenu {
  label: string;
  /** The published menu sheet this was transcribed from. */
  source: string;
  common: Record<MealSlot, string>;
  /** Index 0 is fest day 1 (9 June 2026). */
  days: MenuDay[];
}

export const FEST_MENU: Record<MenuCategory, CategoryMenu> = {
  south_veg: {
    label: 'South Indian · Veg',
    source: 'Veg(Menu A & C)',
    common: {
      breakfast: 'Brown & White Bread, Butter, Tea, Coffee and Milk, Sugar',
      lunch:
        'Plain Rice, Curd, Salt, Sugar, Papad/Fryums & Salad (any three of the Cucumber, Tomato, Beetroot, Radish, Carrot), green chilli',
      dinner:
        'Buttermilk/Lemon Juice, Papad/Fryums & Salad (any three of the Cucumber, Tomato, Beetroot, Radish, Carrot)',
    },
    days: [
      {
        date: '2026-06-09',
        weekday: 'Tuesday',
        breakfast: [
          'Omelette',
          'Chocos',
          'Green Gram Sprouts',
          'Mango Jam',
          'Mysore bonda (1 no)',
          'Khichdi (Rava)',
          'Coconut chutney',
        ],
        lunch: [
          'Phulka',
          'Tomato Rice',
          'Bhindi Fry',
          'Mix Veg Curry',
          'Radish Sambar',
          'Bele Saaru',
          'Mixed Veg Pickle',
          'Mint Thoviyal',
        ],
        dinner: [
          'Plain rice',
          'Kerala Paratha',
          'Veg Kurma',
          'Drumstick Sambar',
          'Seasonal Fruit',
          'Lemon Pickle',
          'Ragi drink',
        ],
      },
      {
        date: '2026-06-10',
        weekday: 'Wednesday',
        breakfast: [
          'Fried Egg',
          'Cornflakes',
          'Boiled Black Chana',
          'Rava Idly',
          'Vada (1 no)',
          'Groundnut chutney',
          'Brinjal Sambar',
        ],
        lunch: [
          'Pudina Chapati',
          'Aloo 65',
          'Cabbage curry',
          'Pepper Rasam',
          'Cucumber Pappu',
          'Lemon Pickle',
          'Ridge Gourd Thoviyal',
          'Detox Water',
        ],
        dinner: [
          'Plain rice',
          'Phulka',
          'Jeera Rice',
          'Palak Paneer',
          'Garlic Rasam',
          'Beetroot Halwa',
          'Mango Pickle',
        ],
      },
      {
        date: '2026-06-11',
        weekday: 'Thursday',
        breakfast: [
          'Boiled egg',
          'Oats',
          'Boiled Peanut',
          'Mix veg Uthappam',
          'Pongal',
          'Coconut chutney',
          'Drumstick Sambar',
        ],
        lunch: [
          'Phulka',
          'Tindly Fry pakodi type',
          'Thotakura papu',
          'Kara kuzhambu',
          'Brinjal Curry',
          'Mixed Veg Pickle',
          'Curd Chilli',
          'Curry Leaf Thoviyal',
        ],
        dinner: [
          'Plain rice',
          'Plain chapathi',
          'Tomato soya curry',
          'Mix veg sambar',
          'Lemon pickle',
          'Boiled Sweet Corn',
        ],
      },
      {
        date: '2026-06-12',
        weekday: 'Friday',
        breakfast: [
          'Boiled Egg',
          'Chocos',
          'Boiled white chana',
          'Mango Jam',
          'Masala Dosa',
          'Mint chutney',
          'Mix veg Sambar',
        ],
        lunch: [
          'Plain Chapati',
          'Bitter Gourd fry',
          'Gutti Vankaya Curry',
          'Jeera Rasam',
          'Spinach Pappu',
          'Lemon Pickle',
          'Gongura Thoviyal',
        ],
        dinner: [
          'Plain Rice',
          'Mixed Veg Sambar',
          'Papaya Fruit',
          'Mango Pickle',
          'Chapathi',
          'Veg kurma',
        ],
      },
      {
        date: '2026-06-13',
        weekday: 'Saturday',
        breakfast: [
          'Omelette',
          'Cornflakes',
          'Boiled green gram',
          'Pineapple Jam',
          'Poori',
          'Aloo masala',
        ],
        lunch: [
          'Phulka',
          'Masala Vada (1 no)',
          'Spinach kootu (Semi Dry)',
          'Ulavacharu',
          'Parippu (Dal) Curry',
          'Tomato chutney (not pickle)',
          'Mint Thoviyal',
        ],
        dinner: [
          'Coconut rice',
          'Sambar Rice',
          'Curd Rice',
          'Boost Milk',
          'Potato chips',
          'Banana Fruit',
        ],
      },
      {
        date: '2026-06-14',
        weekday: 'Sunday',
        breakfast: [
          'Boiled Egg',
          'Oats',
          'Boiled white peas',
          'Mix fruit Jam',
          'Set dosa',
          'Coconut chutney',
          'Bindi Sambar',
        ],
        lunch: [
          'Plain Chapathi',
          'Kuska / Bagara rice',
          'Kadai Paneer',
          'Raita (No Salad)',
          'Cut Onion',
          'Ice Cream',
        ],
        dinner: [
          'Plain Rice',
          'Aloo Parotta',
          'Green Chutney',
          'Curd',
          'Lemon Rasam',
          'Mix Veg Sambar',
          'Mix fruit salad',
          'Mix Veg Pickle',
        ],
      },
    ],
  },
  south_non_veg: {
    label: 'South Indian · Non-veg',
    source: 'Non-Veg (Menu C)',
    common: {
      breakfast: 'Brown & White Bread, Butter, Tea, Coffee and Milk, Sugar',
      lunch:
        'Plain Rice, Curd, Salt, Sugar, Papad/Fryums & Salad (any three of the Cucumber, Tomato, Beetroot, Radish, Carrot), green chilli',
      dinner:
        'Buttermilk/Lemon Juice, Papad/Fryums & Salad (any three of the Cucumber, Tomato, Beetroot, Radish, Carrot), cut onion, mirchi, lemon',
    },
    days: [
      {
        date: '2026-06-09',
        weekday: 'Tuesday',
        breakfast: [
          'Omelette',
          'Chocos',
          'Green Gram Sprouts',
          'Mango Jam',
          'Mysore bonda (1 no)',
          'Khichdi (Rava)',
          'Coconut chutney',
        ],
        lunch: [
          'Phulka',
          'Tomato Rice',
          'Bhindi Fry',
          'Mix Veg Curry',
          'Radish Sambar',
          'Bele Saaru',
          'Mixed Veg Pickle',
          'Mint Thoviyal',
        ],
        dinner: [
          'Plain rice',
          'Kerala Paratha',
          'Veg Kurma',
          'Drumstick Sambar',
          'Seasonal Fruit',
          'Lemon Pickle',
          'Ragi drink',
        ],
      },
      {
        date: '2026-06-10',
        weekday: 'Wednesday',
        breakfast: [
          'Fried Egg',
          'Cornflakes',
          'Boiled Black Chana',
          'Rava Idly',
          'Vada (1 no)',
          'Groundnut chutney',
          'Brinjal Sambar',
        ],
        lunch: [
          'Pudina Chapati',
          'Aloo 65',
          'Cabbage curry',
          'Pepper Rasam',
          'Cucumber Pappu',
          'Lemon Pickle',
          'Ridge Gourd Thoviyal',
          'Detox Water',
        ],
        dinner: [
          'Plain rice',
          'Phulka',
          'Jeera Rice',
          'Kadai Chicken Curry',
          'Garlic Rasam',
          'Beetroot Halwa',
          'Mango Pickle',
        ],
      },
      {
        date: '2026-06-11',
        weekday: 'Thursday',
        breakfast: [
          'Boiled egg',
          'Oats',
          'Boiled Peanut',
          'Mix veg Uthappam',
          'Coconut chutney',
          'Drumstick Sambar',
        ],
        lunch: [
          'Phulka',
          'Tindly Fry pakodi type',
          'Thotakura papu',
          'Kara kuzhambu',
          'Brinjal Curry',
          'Mixed Veg Pickle',
          'Curd Chilli',
          'Curry Leaf Thoviyal',
        ],
        dinner: [
          'Plain rice',
          'Plain chapathi',
          'Egg Mughalai',
          'Mix veg sambar',
          'Boiled Sweet Corn',
          'Lemon Pickle',
        ],
      },
      {
        date: '2026-06-12',
        weekday: 'Friday',
        breakfast: [
          'Boiled Egg',
          'Chocos',
          'Boiled white chana',
          'Mango Jam',
          'Pongal',
          'Mint chutney',
          'Mix veg Sambar',
        ],
        lunch: [
          'Plain Chapati',
          'Bitter Gourd fry',
          'Gutti Vankaya Curry',
          'Jeera Rasam',
          'Spinach Pappu',
          'Lemon Pickle',
          'Gongura Thoviyal',
        ],
        dinner: [
          'Plain Rice',
          'Mixed Veg Sambar',
          'Papaya Fruit',
          'Mango Pickle',
          'Chapathi',
          'Veg kurma',
        ],
      },
      {
        date: '2026-06-13',
        weekday: 'Saturday',
        breakfast: [
          'Omelette',
          'Cornflakes',
          'Boiled green gram',
          'Pineapple Jam',
          'Poori',
          'Aloo masala',
        ],
        lunch: [
          'Phulka',
          'Masala Vada (1 no)',
          'Spinach kootu (Semi Dry)',
          'Ulavacharu',
          'Parippu (Dal) Curry',
          'Tomato chutney (not pickle)',
          'Mint Thoviyal',
        ],
        dinner: [
          'Coconut rice',
          'Sambar Rice',
          'Curd Rice',
          'Boost Milk',
          'Potato chips',
          'Banana Fruit',
        ],
      },
      {
        date: '2026-06-14',
        weekday: 'Sunday',
        breakfast: [
          'Boiled Egg',
          'Oats',
          'Boiled white peas',
          'Mix fruit Jam',
          'Set dosa',
          'Coconut chutney',
          'Bindi Sambar',
        ],
        lunch: [
          'Plain Chapathi',
          'Kuska/ bagara rice',
          'Sherva',
          'Chicken masala',
          'Raita (No Salad)',
          'Cut Onion',
          'Ice Cream',
        ],
        dinner: [
          'Plain Rice',
          'Aloo Parotta',
          'Green Chutney',
          'Curd',
          'Lemon Rasam',
          'Mix Veg Sambar',
          'Mix fruit salad',
          'Mix Veg Pickle',
        ],
      },
    ],
  },
  north_veg: {
    label: 'North Indian · Veg',
    source: 'Veg (Menu C)',
    common: {
      breakfast: 'Brown & White Bread, Butter, Tea, Coffee and Milk, Sugar',
      lunch:
        'Plain Rice, Curd, Salt, Sugar, Papad/Fryums & Salad (any three of the Cucumber, Tomato, Beetroot, Radish, Carrot), green chilli',
      dinner:
        'Buttermilk/Lemon Juice, Papad/Fryums & Salad (any three of the Cucumber, Tomato, Beetroot, Radish, Carrot), cut onion, mirchi, lemon',
    },
    days: [
      {
        date: '2026-06-09',
        weekday: 'Tuesday',
        breakfast: [
          'Mixed fruit jam',
          'Boiled green gram',
          'Boiled egg',
          'Chocos',
          'Kachori',
          'Imli chutney',
          'Aloo sabji',
        ],
        lunch: [
          'Rice',
          'Phulka',
          'Dal (Masoor)',
          'Bhindi Aloo Bhujia',
          'Red Pumpkin Chana Masala',
          'Curd',
        ],
        dinner: [
          'Veg Fried Rice',
          'Chapathi',
          'Toor dal',
          'Veg Manchurian',
          'Water Melon fruit',
          'Buttermilk',
        ],
      },
      {
        date: '2026-06-10',
        weekday: 'Wednesday',
        breakfast: [
          'Mango jam',
          'Boiled Black Chana',
          'Fried Egg/Oats',
          'Pav Bhaji',
          'Pav Bhaji Masala',
        ],
        lunch: [
          'Rice',
          'Phulka',
          'Dal (Rajma)',
          'Carrot Peas Foogath',
          'Aloo Baingan',
          'Tamatar masala',
          'Sweet Lassi',
        ],
        dinner: [
          'Rice',
          'Phulka',
          'Masoor Dal',
          'Paneer Tikka Masala',
          'Seasonal Fruit',
          'Lemon Juice',
        ],
      },
      {
        date: '2026-06-11',
        weekday: 'Thursday',
        breakfast: [
          'Mango jam',
          'Green gram sprouts',
          'Boiled Egg/Cornflakes',
          'Moong Dal Chilla',
          'Tomato + Onion Chutney',
        ],
        lunch: [
          'Rice',
          'Phulka',
          'Dal (Toor)',
          'Cabbage peas sabji (dry)',
          'Lauki Chana Dal (curry)',
          'Fried chilli',
          'Curd',
        ],
        dinner: ['Jeera Rice', 'Methi Puri', 'Dal Tadka', 'Black Chana Curry', 'Sabudhana Kheer'],
      },
      {
        date: '2026-06-12',
        weekday: 'Friday',
        breakfast: [
          'Mixed Fruit Jam',
          'Millet sprouts',
          'Fried Egg/Oats',
          'Semiya Khichdi',
          'Coconut Chutney',
        ],
        lunch: ['Rice', 'Phulka', 'Dal (Chana)', 'Karela fry', 'Aloo matar (gravy)', 'Curd'],
        dinner: [
          'Rice',
          'Chapati',
          'Fried Dal',
          'Soya chunk Curry',
          'Muskmelon fruit',
          'Buttermilk',
        ],
      },
      {
        date: '2026-06-13',
        weekday: 'Saturday',
        breakfast: [
          'Pineapple Jam',
          'Boiled Peanut',
          'Boiled Egg',
          'Chocos',
          'Aloo Paratha',
          'Plain curd',
          'Green Chutney',
        ],
        lunch: [
          'Rice',
          'Green Methi Paratha',
          'Mixed Dal Tadka',
          'Aloo 65',
          'Ridge gourd chana masala',
          'Curd',
        ],
        dinner: [
          'Rice',
          'Phulka',
          'Masoor Dal',
          'Tawa mix veg sabzi',
          'Banana fruit',
          'Milk + Boost',
        ],
      },
      {
        date: '2026-06-14',
        weekday: 'Sunday',
        breakfast: [
          'Mango jam',
          'Boiled Mixed sprouts',
          'Boiled Egg/Oats',
          'Plain Dosa',
          'Mix veg Sambar',
          'Onion Tomato Chutney',
        ],
        lunch: [
          'Veg Hyderabadi Biryani',
          'Phulka',
          'Dal (Toor Dal)',
          'Raita',
          'Onion + Lemon salad',
          'Paneer Butter Masala',
          'Sahi Tukda',
        ],
        dinner: ['Rice', 'Moong Dal', 'Chole bhature', 'Seasonal Fruit', 'Lemon Juice'],
      },
    ],
  },
  north_non_veg: {
    label: 'North Indian · Non-veg',
    source: 'Non-Veg (Menu A)',
    common: {
      breakfast: 'Brown & White Bread, Butter, Tea, Coffee and Milk, Sugar',
      lunch:
        'Plain Rice, Curd, Salt, Sugar, Papad/Fryums & Salad (any three of the Cucumber, Tomato, Beetroot, Radish, Carrot), green chilli',
      dinner:
        'Buttermilk/Lemon Juice, Papad/Fryums & Salad (any three of the Cucumber, Tomato, Beetroot, Radish, Carrot), cut onion, mirchi, lemon',
    },
    days: [
      {
        date: '2026-06-09',
        weekday: 'Tuesday',
        breakfast: [
          'Mixed fruit jam',
          'Boiled green gram',
          'Boiled Egg',
          'Chocos',
          'Kachori',
          'Imli chutney',
          'Aloo sabji',
        ],
        lunch: [
          'Rice',
          'Phulka',
          'Dal (Masoor)',
          'Bhindi Aloo Bhujia',
          'Red Pumpkin Chana Masala',
          'Curd',
        ],
        dinner: [
          'Veg Fried Rice',
          'Chapathi',
          'Toor dal',
          'Veg Manchurian',
          'Watermelon fruit',
          'Buttermilk',
        ],
      },
      {
        date: '2026-06-10',
        weekday: 'Wednesday',
        breakfast: [
          'Mango jam',
          'Boiled Black Chana',
          'Fried Egg/Oats',
          'Pav Bhaji',
          'Pav Bhaji Masala',
        ],
        lunch: [
          'Rice',
          'Phulka',
          'Dal (Rajma)',
          'Carrot Peas Foogath',
          'Aloo Baingan',
          'Tamatar masala',
          'Sweet Lassi',
        ],
        dinner: [
          'Rice',
          'Phulka',
          'Masoor Dal',
          'Chicken Tikka Masala',
          'Seasonal Fruit (Papaya, Orange, etc.)',
          'Lemon Juice',
        ],
      },
      {
        date: '2026-06-11',
        weekday: 'Thursday',
        breakfast: [
          'Mango jam',
          'Green gram sprouts',
          'Boiled Egg/Cornflakes',
          'Moong Dal Chilla',
          'Tomato + Onion Chutney',
        ],
        lunch: [
          'Rice',
          'Phulka',
          'Dal (Toor)',
          'Cabbage peas sabji (dry)',
          'Lauki Chana Dal (curry)',
          'Fried chilli',
          'Curd',
        ],
        dinner: ['Jeera Rice', 'Methi Puri', 'Dal Tadka', 'Black Chana Curry', 'Sabudhana Kheer'],
      },
      {
        date: '2026-06-12',
        weekday: 'Friday',
        breakfast: [
          'Mix fruit Jam',
          'Millet sprouts',
          'Fried Egg/Oats',
          'Semiya Khichdi',
          'Coconut Chutney',
        ],
        lunch: ['Rice', 'Phulka', 'Dal (Chana)', 'Karela fry', 'Aloo matar (gravy)', 'Curd'],
        dinner: [
          'Rice',
          'Chapati',
          'Fried Dal',
          'Egg Mughlai (1 pc)',
          'Musk melon fruit',
          'Buttermilk',
        ],
      },
      {
        date: '2026-06-13',
        weekday: 'Saturday',
        breakfast: [
          'Pineapple Jam',
          'Boiled Peanut',
          'Boiled Egg',
          'Chocos',
          'Aloo Paratha',
          'Plain curd',
          'Green chutney',
        ],
        lunch: [
          'Rice',
          'Green Methi Paratha',
          'Mixed Dal Tadka',
          'Aloo 65',
          'Ridge gourd chana Masala',
          'Curd',
        ],
        dinner: [
          'Rice',
          'Phulka',
          'Masoor Dal',
          'Tawa mix veg sabji',
          'Banana fruit',
          'Milk + Boost',
        ],
      },
      {
        date: '2026-06-14',
        weekday: 'Sunday',
        breakfast: [
          'Mango jam',
          'Boiled Mixed sprouts',
          'Boiled Egg/Oats',
          'Plain Dosa',
          'Mix veg Sambar',
          'Onion Tomato Chutney',
        ],
        lunch: [
          'Hyderabadi Chicken Dum Biryani',
          'Rice',
          'Phulka',
          'Dal (Toor)',
          'Onion Raita',
          'Sahi Tukda',
        ],
        dinner: ['Rice', 'Moong Dal', 'Chole bhature', 'Seasonal fruit', 'Lemon Juice'],
      },
    ],
  },
  north_veg_no_onion_garlic: {
    label: 'North Indian · Veg, no onion or garlic',
    source: 'Pure Veg (Menu A)',
    common: {
      breakfast: 'Brown & White Bread, Butter, Tea, Coffee and Milk, Sugar',
      lunch:
        'Plain Rice, Curd, Salt, Sugar, Papad/Fryums & Salad (any three of the Cucumber, Tomato, Beetroot, Radish, Carrot), green chilli',
      dinner:
        'Buttermilk/Lemon Juice, Papad/Fryums & Salad (any three of the Cucumber, Tomato, Beetroot, Radish, Carrot), cut onion, mirchi, lemon',
    },
    days: [
      {
        date: '2026-06-09',
        weekday: 'Tuesday',
        breakfast: [
          'Mixed fruit jam',
          'Boiled green gram',
          'Fried Egg',
          'Chocos',
          'Kachori',
          'Imli chutney',
          'Aloo sabji',
        ],
        lunch: [
          'Rice',
          'Phulka',
          'Dal (Masoor)',
          'Bhindi Aloo Bhujia',
          'Red Pumpkin Chana Masala',
          'Tori Ki Sabzi (Sponge gourd)',
          'Curd',
        ],
        dinner: [
          'Veg Fried Rice',
          'Roti',
          'Toor dal',
          'Veg Manchurian',
          'Watermelon fruit',
          'Buttermilk',
        ],
      },
      {
        date: '2026-06-10',
        weekday: 'Wednesday',
        breakfast: ['Mango jam', 'Boiled Black Chana', 'Oats', 'Pav Bhaji', 'Pav Bhaji Masala'],
        lunch: [
          'Rice',
          'Phulka',
          'Dal (Rajma)',
          'Carrot Peas foogath',
          'Peas Masala',
          'Aloo Baigan Tamatar masala',
          'Sev Tamatar',
          'Detox Water',
          'Sweet Lassi',
        ],
        dinner: [
          'Ghee rice',
          'Roti',
          'Masoor Dal',
          'Kadai Paneer',
          'Seasonal Fruit',
          'Lemon Juice',
        ],
      },
      {
        date: '2026-06-11',
        weekday: 'Thursday',
        breakfast: [
          'Mango jam',
          'Green gram Sprouts',
          'Oats',
          'Moong Dal Chilla',
          'Tomato + Onion Chutney',
        ],
        lunch: [
          'Rice',
          'Phulka',
          'Dal (Toor)',
          'Aloo Karela (dry)',
          'Lauki Chana Dal (semi-fry)',
          'Curd',
        ],
        dinner: ['Peas Pulao', 'Methi Puri', 'Dal Tadka', 'Black Chana Curry', 'Sabudhana Kheer'],
      },
      {
        date: '2026-06-12',
        weekday: 'Friday',
        breakfast: [
          'Mix fruit Jam',
          'Millet sprouts',
          'Cornflakes',
          'Semiya Khichdi',
          'Coconut Chutney',
        ],
        lunch: [
          'Rice',
          'Roti',
          'Dal (Chana)',
          'Cabbage Peas dry',
          'Mix veg Curry',
          'Fried green Chilli',
          'Curd',
        ],
        dinner: [
          'Rice',
          'Chapati',
          'Fried Dal',
          'Soya Chunk curry',
          'Musk melon fruit',
          'Buttermilk',
        ],
      },
      {
        date: '2026-06-13',
        weekday: 'Saturday',
        breakfast: [
          'Pineapple Jam',
          'Boiled green Gram',
          'Chocos',
          'Aloo Paratha',
          'Cabbage Paratha',
          'Curd',
          'Green Chutney',
        ],
        lunch: [
          'Rice',
          'Green Methi Paratha',
          'Mixed Dal Tadka',
          'Jeera Aloo',
          'Tindly Fry',
          'Ridge gourd masala',
          'Curd',
        ],
        dinner: [
          'Rice',
          'Roti',
          'Masoor Dal',
          'Tawa mix veg sabzi',
          'Banana fruit',
          'Milk + Boost',
        ],
      },
      {
        date: '2026-06-14',
        weekday: 'Sunday',
        breakfast: [
          'Mango jam',
          'Chole / Green Gram sprouts',
          'Oats',
          'Plain Dosa',
          'Aloo masala',
          'Mix veg Sambhar',
          'Coconut Chutney',
        ],
        lunch: [
          'Veg Hyderabadi Biryani',
          'Roti',
          'Onion / Cucumber raita',
          'Paneer Butter Masala',
          'Sahi Tukda',
        ],
        dinner: ['Rice', 'Chole Bhature', 'Dal (Moong)', 'Seasonal Fruit', 'Lemon Juice'],
      },
    ],
  },
  unified_veg: {
    label: 'Unified · Veg',
    source: 'Unified Veg (Week C)',
    common: {
      breakfast: 'Brown Bread, Butter, Jam, Tea, Coffee and Milk, Sugar',
      lunch: 'Plain Rice, Phulka, Curd, Salt, Sugar, Papad/Fryums',
      dinner: 'Plain Rice, Sugar, Salt, Papad/Fryums',
    },
    days: [
      {
        date: '2026-06-09',
        weekday: 'Tuesday',
        breakfast: [
          'Omelette/Chocos',
          'Green Gram Sprouts',
          'Idli',
          'Ghee & Podi',
          'Sambar',
          'Coconut chutney',
        ],
        lunch: [
          'Beetroot tomato salad',
          'Potato spinach sabzi (dry)',
          'Tomato drumstick curry (gravy)',
          'Masoor dal Kuzhambu (gravy)',
          'Pepper Rasam',
          'Ridge Gourd Thoviyal',
        ],
        dinner: ['Set Dosa', 'Tomato chutney', 'Mix veg Sambar', 'Buttermilk', 'Mixed fruit'],
      },
      {
        date: '2026-06-10',
        weekday: 'Wednesday',
        breakfast: ['Fried egg/Oats', 'Boiled Peanut', 'Tomato chutney', 'Gobi Paratha & Curd'],
        lunch: [
          'Radish cucumber salad',
          'Cabbage poriyal (dry)',
          'Bhindi puli',
          'Kuzhambu(gravy)',
          'Dal Fry',
          'Ridge Gourd Thoviyal',
        ],
        dinner: [
          'Phulka',
          'Jeera Rice',
          'Paneer butter Masala',
          'Garlic Rasam',
          'Pineapple rava kesari',
          'Lemon water',
          'Salad',
        ],
      },
      {
        date: '2026-06-11',
        weekday: 'Thursday',
        breakfast: [
          'Boiled Egg/Cornflakes',
          'Boiled Black Chana',
          'Onion Uthapam',
          'Coconut chutney',
        ],
        lunch: [
          'Cucumber carrot salad',
          'Carrot sag sabzi (dry)',
          'Soya chunks kurma (gravy)',
          'Moong Dal',
          'Tomato rasam',
          'Curry Leaf Thoviyal',
          'Lassi',
        ],
        dinner: [
          'Pudina chapathi',
          'Baby Corn Potato Peas Curry',
          'Mix Veg Curry',
          'Buttermilk',
          'Papaya Fruit',
        ],
      },
      {
        date: '2026-06-12',
        weekday: 'Friday',
        breakfast: [
          'Boiled egg',
          'Chocos',
          'Boiled white chana',
          'Puffed rice upma',
          'Mint chutney',
          'Tomato sauce',
        ],
        lunch: [
          'Beetroot tomato salad',
          'Aloo Pumpkin fry',
          'Gutti Vankaya Curry (gravy)',
          'Moong dal',
          'Gongura Thoviyal',
        ],
        dinner: ['Plain Chapathi', 'Dahi Bhindi', 'Mixed Dal', 'Ragi Drink', 'Salad'],
      },
      {
        date: '2026-06-13',
        weekday: 'Saturday',
        breakfast: ['Omelette', 'Oats', 'Boiled green gram', 'Moong dal chilla', 'Tomato sauce'],
        lunch: [
          'Radish cucumber salad',
          'Aloo baingan (dry)',
          'Chow chow curry (gravy)',
          'Toor dal',
          'Pepper rasam',
          'Tomato Thoviyal',
        ],
        dinner: [
          'Masala khichdi',
          'Curd Rice',
          'Boost Milk',
          'Roti',
          'Rajma Dal',
          'Potato Chips',
          'Banana Fruit',
        ],
      },
      {
        date: '2026-06-14',
        weekday: 'Sunday',
        breakfast: [
          'Fried Egg/Cornflakes',
          'Boiled white peas',
          'Luchi (poori)',
          'Aloo dum',
          'Lime and onion',
        ],
        lunch: [
          'Onion lemon Cucumber salad',
          'Bagara rice',
          'Sherva',
          'Paneer Butter Masala',
          'Tomato Rasam',
          'Onion Tomato Raita',
          'Kala Jamun - 2 pieces',
        ],
        dinner: [
          'Pudina Chapathi',
          'Loki Koftha curry',
          'Drumstick Sambar',
          'Buttermilk',
          'Pineapple',
          'Salad',
        ],
      },
    ],
  },
  unified_non_veg: {
    label: 'Unified · Non-veg',
    source: 'Unified Veg (Week C)',
    common: {
      breakfast: 'Brown Bread, Butter, Jam, Tea, Coffee and Milk, Sugar',
      lunch: 'Plain Rice, Phulka, Curd, Salt, Sugar, Papad/Fryums',
      dinner: 'Plain Rice, Sugar, Salt, Papad/Fryums',
    },
    days: [
      {
        date: '2026-06-09',
        weekday: 'Tuesday',
        breakfast: [
          'Omelette/Chocos',
          'Green Gram Sprouts',
          'Idli',
          'Ghee & Podi',
          'Sambar',
          'Coconut chutney',
        ],
        lunch: [
          'Beetroot tomato salad',
          'Potato spinach sabzi (dry)',
          'Tomato drumstick curry (gravy)',
          'Masoor dal Kuzhambu (gravy)',
          'Pepper Rasam',
          'Ridge Gourd Thoviyal',
        ],
        dinner: ['Set Dosa', 'Tomato chutney', 'Mix veg Sambar', 'Buttermilk', 'Mixed fruit'],
      },
      {
        date: '2026-06-10',
        weekday: 'Wednesday',
        breakfast: ['Fried egg/Oats', 'Boiled Peanut', 'Tomato chutney', 'Gobi Paratha & Curd'],
        lunch: [
          'Radish cucumber salad',
          'Cabbage poriyal (dry)',
          'Bhindi puli',
          'Kuzhambu(gravy)',
          'Dal Fry',
          'Ridge Gourd Thoviyal',
        ],
        dinner: [
          'Phulka',
          'Jeera Rice',
          'Pepper Chicken',
          'Garlic Rasam',
          'Pineapple rava kesari',
          'Lemon water',
          'Salad',
        ],
      },
      {
        date: '2026-06-11',
        weekday: 'Thursday',
        breakfast: [
          'Boiled Egg/Cornflakes',
          'Boiled Black Chana',
          'Onion Uthapam',
          'Coconut chutney',
        ],
        lunch: [
          'Cucumber carrot salad',
          'Carrot sag sabzi (dry)',
          'Soya chunks kurma (gravy)',
          'Moong Dal',
          'Tomato rasam',
          'Curry Leaf Thoviyal',
          'Lassi',
        ],
        dinner: [
          'Pudina chapathi',
          'Kerala egg roast masala',
          'Mix Veg Curry',
          'Buttermilk',
          'Papaya Fruit',
        ],
      },
      {
        date: '2026-06-12',
        weekday: 'Friday',
        breakfast: [
          'Boiled egg',
          'Chocos',
          'Boiled white chana',
          'Puffed rice upma',
          'Mint chutney',
          'Tomato sauce',
        ],
        lunch: [
          'Beetroot tomato salad',
          'Aloo Pumpkin fry',
          'Gutti Vankaya Curry (gravy)',
          'Moong dal',
          'Gongura Thoviyal',
        ],
        dinner: ['Plain Chapathi', 'Dahi Bhindi', 'Mixed Dal', 'Ragi Drink', 'Salad'],
      },
      {
        date: '2026-06-13',
        weekday: 'Saturday',
        breakfast: ['Omelette', 'Oats', 'Boiled green gram', 'Moong dal chilla', 'Tomato sauce'],
        lunch: [
          'Radish cucumber salad',
          'Aloo baingan (dry)',
          'Chow chow curry (gravy)',
          'Toor dal',
          'Pepper rasam',
          'Tomato Thoviyal',
        ],
        dinner: [
          'Masala khichdi',
          'Curd Rice',
          'Boost Milk',
          'Roti',
          'Rajma Dal',
          'Potato Chips',
          'Banana Fruit',
        ],
      },
      {
        date: '2026-06-14',
        weekday: 'Sunday',
        breakfast: [
          'Fried Egg/Cornflakes',
          'Boiled white peas',
          'Luchi (poori)',
          'Aloo dum',
          'Lime and onion',
        ],
        lunch: [
          'Onion lemon Cucumber salad',
          'Bagara rice',
          'Sherva',
          'Butter Chicken masala',
          'Tomato Rasam',
          'Onion Tomato Raita',
          'Kala Jamun - 2 pieces',
        ],
        dinner: [
          'Pudina Chapathi',
          'Loki Koftha curry',
          'Drumstick Sambar',
          'Buttermilk',
          'Pineapple',
          'Salad',
        ],
      },
    ],
  },
};
