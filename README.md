# The Edit Atlas

A research-driven discovery interface for exploring hotels in Chase Travel's "The Edit" collection.

## What this is

The Edit Atlas is an independent browsing experience for the ~1,370 hotels associated with The Edit by Chase Travel. It is designed to make it easy for Chase Sapphire cardholders to scan, compare, and explore hotels across countries and destinations in a way that Chase's own portal does not support well.

The site is built around the idea that premium-card holders deserve a better way to find where their benefits apply. Chase's booking portal obscures filtering, buries credit-eligible properties, and makes side-by-side comparison difficult. This project exists to fill that gap.

## What it helps users do

- Browse hotels by country in a clean, editorial layout
- Switch to a map view for geographic discovery
- Search by property name, city, country, or partner brand
- Filter by collection type, star rating, price range, partner brand, and Tripadvisor rating
- Identify which hotels fall under Chase's seven $250-credit partner groups
- Quickly jump out to research any property further

## What it is not

This is not an official Chase product. It does not display live pricing, process bookings, or claim to represent a complete official roster of every Chase hotel-credit offer. It is a research and discovery tool built from publicly available data.

## Data

The hotel catalog is assembled from public research, a mirrored third-party dataset, and interpretation of Chase's publicly described partner groups. Some information is directional rather than officially published. Displayed prices are preview estimates, not live Chase Travel quotes.

The seven recognized $250-credit partner groups are:

- IHG Hotels & Resorts
- Montage Hotels & Resorts
- Pendry Hotels & Resorts
- Omni Hotels & Resorts
- Virgin Hotels
- Minor Hotels
- Pan Pacific Hotels Group

## Running locally

```bash
npm install
npm run dev
```

## Building

```bash
npm run build
npm run preview
```

## Rebuilding the dataset

```bash
node scripts_extract_public_edit.js
node scripts_build_properties.js
```
