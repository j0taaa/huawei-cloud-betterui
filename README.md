# Huawei Cloud Better UI

This repository is another version of the Huawei Cloud UI made to have most of the original functionalities, but faster, with better UI, caching, mobile responsiveness and more functions.

## Stack

- [Next.js](https://nextjs.org) App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- lucide-react icons

## Project Shape

- `src/app/page.tsx` contains the first cloud console screen.
- `src/lib/cloud-data.ts` keeps placeholder service, metric, resource, and roadmap data until real Huawei Cloud APIs are wired in.
- `src/components/ui` is the shadcn/ui component directory.

## Getting Started

Install dependencies, then run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Scripts

- `npm run dev` starts the local Next.js server.
- `npm run build` creates a production build.
- `npm run start` serves the production build.
- `npm run lint` runs ESLint.

## Next Work

- Replace placeholder data with Huawei Cloud SDK/API integrations.
- Add cache-aware route handlers for service, billing, and resource pages.
- Expand mobile-first console flows.
- Build the final visual system with Tailwind CSS and shadcn/ui components.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [shadcn/ui Documentation](https://ui.shadcn.com)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
