# Nanded Shop Analyzer

An AI-powered location intelligence web application for analyzing retail and service business distribution inside **Nanded City township, Pune, Maharashtra**.

## Features
- **Google Maps & Places Integration:** Multi-sector `Place.searchByText()` collection with ID/coordinate deduplication and ray-casting boundary filtering.
- **Geographical Zone Division:** Clipped 3x3 spatial grid using Sutherland–Hodgman polygon clipping with accurate planar area (`km²`) and zone density calculations.
- **Visual Heat Overlays:** Color-coded zones (Green = Low presence, Amber = Medium, Red = High), interactive markers with InfoWindows, and toggleable layers.
- **Transparent Opportunity Scoring:** Supply-side preliminary indicator combining Local Supply Gap (50%), Density Relief (30%), and Neighbor Competition Relief (20%).
- **Claude AI Advisor:** Secure Node.js + Express backend calling Anthropic Claude to interpret zone metrics and suggest field-verification steps.

## Running Locally

### 1. Backend Terminal (`server/`)
```powershell
cd server
npm install
copy .env.example .env
# Add your ANTHROPIC_API_KEY inside server/.env
npm run dev