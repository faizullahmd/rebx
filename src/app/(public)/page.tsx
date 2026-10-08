import Link from "next/link";
import { auth } from "@/auth";
import { ListingCard } from "@/components/listings/ListingCard";
import { getRecentActiveListings } from "@/lib/data/listings";

export default async function HomePage() {
  const session = await auth();
  const listings = await getRecentActiveListings(6);
  const agentHref = session?.user ? "/agent/dashboard" : "/login";
  const developerHref =
    session?.user?.role === "DEVELOPER"
      ? "/developer/dashboard"
      : "/signup";
  const listPropertyHref =
    session?.user?.role === "AGENT" || session?.user?.role === "ADMIN"
      ? "/agent/dashboard/listings/new"
      : session?.user?.role === "CUSTOMER"
        ? "/list-property"
        : session?.user
          ? "/developer/dashboard"
          : "/login?callbackUrl=%2Fagent%2Fdashboard%2Flistings%2Fnew";

  return (
    <div className="flex flex-col">
      {/* 2. HERO SECTION */}
      <section className="border-b border-neutral-200/80 bg-white py-14 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16">
            {/* Left Column: Text & Actions */}
            <div className="flex flex-col items-start lg:col-span-7">
              <span className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-3.5 py-1 text-xs font-medium tracking-wide text-neutral-700">
                <span className="h-1.5 w-1.5 rounded-full bg-neutral-900" />
                Real Estate Broker Exchange
              </span>

              <h1 className="mt-4 text-2xl sm:text-4xl md:text-5xl lg:text-[54px] font-semibold tracking-tight text-neutral-950 lg:leading-[1.12]">
                The smarter way to connect, collaborate and close real estate deals.
              </h1>

              <p className="mt-4 sm:mt-6 max-w-2xl text-sm sm:text-base leading-relaxed text-neutral-600 sm:text-lg">
                REBX connects agents, developers and customers on one platform — from discovering and listing properties to tracking deals through to commission.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3.5 sm:gap-4">
                <Link
                  href="/listings"
                  className="rounded-md bg-neutral-900 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-neutral-800"
                >
                  Browse Listings
                </Link>
                <Link
                  href={agentHref}
                  className="rounded-md border border-neutral-300 bg-white px-6 py-3.5 text-sm font-semibold text-neutral-800 transition-colors hover:bg-neutral-50"
                >
                  Join as an Agent
                </Link>
              </div>

              <div className="mt-10 flex items-center gap-6 border-t border-neutral-100 pt-6 text-xs text-neutral-500">
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 text-neutral-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Verified broker network</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 text-neutral-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>End-to-end deal pipeline</span>
                </div>
              </div>
            </div>

            {/* Right Column: Hero Property Image */}
            <div className="lg:col-span-5">
              <div className="relative overflow-hidden rounded-lg border border-neutral-200/90 bg-neutral-100 shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/hero-property.jpg"
                  alt="Modern architectural property featured on REBX"
                  className="aspect-[4/3] w-full object-cover sm:aspect-[5/4] lg:aspect-[4/3]"
                />
                <div className="border-t border-neutral-200/80 bg-white/95 p-4 backdrop-blur-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                        REBX Exchange Network
                      </p>
                      <p className="text-sm font-medium text-neutral-900">
                        Connecting Agents, Developers & Clients
                      </p>
                    </div>
                    <Link
                      href="/listings"
                      className="text-xs font-semibold text-neutral-900 hover:underline"
                    >
                      Explore →
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. WHY REBX SECTION */}
      <section className="border-b border-neutral-200/80 bg-neutral-50/60 py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <h2 className="text-xl font-semibold tracking-tight text-neutral-950 sm:text-3xl lg:text-4xl">
              Why REBX?
            </h2>
            <p className="mt-3 text-base text-neutral-600 sm:text-lg">
              Everything you need to make real estate collaboration simpler, faster and more transparent.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {/* Card 1: CONNECT */}
            <div className="flex flex-col rounded-lg border border-neutral-200/90 bg-white p-7 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md">
              <div className="flex h-11 w-11 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 text-neutral-900">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.75}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </div>
              <h3 className="mt-5 text-sm font-bold tracking-wider text-neutral-900">
                CONNECT
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                Connect agents, developers and customers through a centralized real-estate exchange.
              </p>
            </div>

            {/* Card 2: DISCOVER */}
            <div className="flex flex-col rounded-lg border border-neutral-200/90 bg-white p-7 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md">
              <div className="flex h-11 w-11 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 text-neutral-900">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.75}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <h3 className="mt-5 text-sm font-bold tracking-wider text-neutral-900">
                DISCOVER
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                Explore available properties and discover new opportunities across the network.
              </p>
            </div>

            {/* Card 3: TRACK */}
            <div className="flex flex-col rounded-lg border border-neutral-200/90 bg-white p-7 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md">
              <div className="flex h-11 w-11 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 text-neutral-900">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.75}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                  />
                </svg>
              </div>
              <h3 className="mt-5 text-sm font-bold tracking-wider text-neutral-900">
                TRACK
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                Follow your deal journey from property listing to successful transaction.
              </p>
            </div>

            {/* Card 4: COMMISSIONS */}
            <div className="flex flex-col rounded-lg border border-neutral-200/90 bg-white p-7 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md">
              <div className="flex h-11 w-11 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 text-neutral-900">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.75}
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h3 className="mt-5 text-sm font-bold tracking-wider text-neutral-900">
                COMMISSIONS
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                Keep visibility on your deals and commissions throughout the transaction.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. HOW REBX WORKS */}
      <section className="border-b border-neutral-200/80 bg-white py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <h2 className="text-xl font-semibold tracking-tight text-neutral-950 sm:text-3xl lg:text-4xl">
              How REBX Works
            </h2>
            <p className="mt-3 text-base text-neutral-600 sm:text-lg">
              From listing a property to completing a deal, REBX keeps the process connected.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
            {/* Step 1 */}
            <div className="relative flex flex-col rounded-lg border border-neutral-200/80 bg-white p-6 shadow-2xs">
              <span className="text-3xl font-bold tracking-tight text-neutral-300">
                01
              </span>
              <h3 className="mt-4 text-base font-bold tracking-wide text-neutral-900">
                01 — LIST
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                Add your property and make it visible to the broker network.
              </p>
            </div>

            {/* Step 2 */}
            <div className="relative flex flex-col rounded-lg border border-neutral-200/80 bg-white p-6 shadow-2xs">
              <span className="text-3xl font-bold tracking-tight text-neutral-300">
                02
              </span>
              <h3 className="mt-4 text-base font-bold tracking-wide text-neutral-900">
                02 — CONNECT
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                Connect with agents, developers and potential customers.
              </p>
            </div>

            {/* Step 3 */}
            <div className="relative flex flex-col rounded-lg border border-neutral-200/80 bg-white p-6 shadow-2xs">
              <span className="text-3xl font-bold tracking-tight text-neutral-300">
                03
              </span>
              <h3 className="mt-4 text-base font-bold tracking-wide text-neutral-900">
                03 — COLLABORATE
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                Work together to move the property opportunity forward.
              </p>
            </div>

            {/* Step 4 */}
            <div className="relative flex flex-col rounded-lg border border-neutral-200/80 bg-white p-6 shadow-2xs">
              <span className="text-3xl font-bold tracking-tight text-neutral-300">
                04
              </span>
              <h3 className="mt-4 text-base font-bold tracking-wide text-neutral-900">
                04 — CLOSE
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                Track the transaction and commission through completion.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. RECENTLY LISTED */}
      <section className="border-b border-neutral-200/80 bg-neutral-50/50 py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-neutral-950 sm:text-3xl lg:text-4xl">
                Recently Listed Properties
              </h2>
              <p className="mt-3 text-base text-neutral-600">
                Explore the latest properties available on the REBX exchange.
              </p>
            </div>
            <Link
              href="/listings"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-900 transition-colors hover:text-neutral-600"
            >
              <span>View All Listings</span>
              <span>→</span>
            </Link>
          </div>

          <div className="mt-12">
            {listings.length === 0 ? (
              <div className="rounded-lg border border-neutral-200 bg-white p-12 text-center">
                <p className="text-sm font-medium text-neutral-600">
                  No active listings available right now.
                </p>
                <div className="mt-4">
                  <Link
                    href="/listings"
                    className="inline-flex rounded-md bg-neutral-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-neutral-800"
                  >
                    View All Listings
                  </Link>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {listings.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} />
                ))}
              </div>
            )}
          </div>

          <div className="mt-12 text-center sm:hidden">
            <Link
              href="/listings"
              className="inline-flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-5 py-2.5 text-sm font-semibold text-neutral-800"
            >
              View All Listings →
            </Link>
          </div>
        </div>
      </section>

      {/* 6. FOR REAL ESTATE AGENTS */}
      <section className="border-b border-neutral-200/80 bg-white py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16">
            {/* Left Content */}
            <div className="flex flex-col items-start lg:col-span-6">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                Agent & Broker CRM
              </span>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-neutral-950 sm:text-3xl lg:text-4xl">
                Built for Real Estate Agents
              </h2>
              <p className="mt-4 text-base leading-relaxed text-neutral-600">
                Discover new property opportunities, connect with developers and expand your business through a single platform.
              </p>

              <ul className="mt-6 flex flex-col gap-3 text-sm text-neutral-700">
                <li className="flex items-center gap-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-900">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <span>Discover property opportunities</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-900">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <span>Connect with developers</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-900">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <span>Collaborate with other agents</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-900">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <span>Track deals</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-900">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <span>Monitor commissions</span>
                </li>
              </ul>

              <div className="mt-8">
                <Link
                  href={agentHref}
                  className="inline-flex items-center gap-2 rounded-md bg-neutral-900 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-neutral-800"
                >
                  <span>Join as an Agent</span>
                  <span>→</span>
                </Link>
              </div>
            </div>

            {/* Right Image */}
            <div className="lg:col-span-6">
              <div className="overflow-hidden rounded-lg border border-neutral-200/90 bg-neutral-100 shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/agent-collaborate.jpg"
                  alt="Real estate professional reviewing listings on REBX"
                  className="aspect-[4/3] w-full object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 7. FOR DEVELOPERS */}
      <section className="border-b border-neutral-200/80 bg-neutral-50/50 py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16">
            {/* Left Image (stacks above on mobile, left on desktop) */}
            <div className="lg:col-span-6">
              <div className="overflow-hidden rounded-lg border border-neutral-200/90 bg-neutral-100 shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/developer-projects.jpg"
                  alt="Grow Your Real Estate Projects with REBX"
                  className="aspect-[4/3] w-full object-cover"
                />
              </div>
            </div>

            {/* Right Content */}
            <div className="flex flex-col items-start lg:col-span-6">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                PROPERTY DEVELOPERS
              </span>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-neutral-950 sm:text-3xl lg:text-4xl">
                Grow Your Real Estate Projects with REBX
              </h2>
              <p className="mt-4 text-base leading-relaxed text-neutral-600 sm:text-lg">
                Connect your properties with a network of real estate agents and brokers through REBX.
              </p>

              <ul className="mt-6 flex flex-col gap-3 text-sm text-neutral-700">
                <li className="flex items-center gap-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-900">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <span>Showcase your properties</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-900">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <span>Connect with agents & brokers</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-900">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <span>Manage your property opportunities</span>
                </li>
              </ul>

              <div className="mt-8">
                <Link
                  href={developerHref}
                  className="inline-flex items-center gap-2 rounded-md bg-neutral-900 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-neutral-800"
                >
                  <span>Join as a Developer</span>
                  <span>→</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 8. LIST A PROPERTY */}
      <section className="border-b border-neutral-200/80 bg-white py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16">
            {/* Left Content */}
            <div className="flex flex-col items-start lg:col-span-6">
              <h2 className="text-xl font-semibold tracking-tight text-neutral-950 sm:text-3xl lg:text-4xl">
                Get Your Properties in Front of the Right Network
              </h2>
              <p className="mt-4 text-base leading-relaxed text-neutral-600 sm:text-lg">
                List your properties on REBX and connect with a network of real estate professionals who can help bring your properties to potential customers.
              </p>

              <div className="mt-8">
                <Link
                  href={listPropertyHref}
                  className="inline-flex items-center gap-2 rounded-md bg-neutral-900 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-neutral-800"
                >
                  <span>List a Property</span>
                  <span>→</span>
                </Link>
              </div>
            </div>

            {/* Right Image */}
            <div className="lg:col-span-6">
              <div className="overflow-hidden rounded-lg border border-neutral-200/90 bg-neutral-100 shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/developer-property.jpg"
                  alt="Modern development property on REBX"
                  className="aspect-[4/3] w-full object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 9. FINAL CTA */}
      <section className="bg-white py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-xl border border-neutral-200 bg-neutral-50/80 px-6 py-14 text-center sm:px-12 sm:py-20 lg:px-16">
            <h2 className="text-xl font-semibold tracking-tight text-neutral-950 sm:text-3xl lg:text-4xl">
              Ready to take the next step in your real estate journey?
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-neutral-600 sm:text-lg">
              Explore available properties or become part of the REBX network.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/listings"
                className="rounded-md bg-neutral-900 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-neutral-800"
              >
                Browse Listings
              </Link>
              <Link
                href={agentHref}
                className="rounded-md border border-neutral-300 bg-white px-6 py-3.5 text-sm font-semibold text-neutral-800 transition-colors hover:bg-neutral-50"
              >
                Join as an Agent
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
