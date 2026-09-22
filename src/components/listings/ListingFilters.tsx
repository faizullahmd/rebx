export function ListingFilters({
  defaultValues,
}: {
  defaultValues: { city?: string; minPrice?: string; maxPrice?: string; bedrooms?: string };
}) {
  return (
    <form className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 p-4" action="/listings">
      <div className="flex flex-col gap-1">
        <label htmlFor="city" className="text-xs text-gray-500">
          City
        </label>
        <input
          id="city"
          name="city"
          defaultValue={defaultValues.city}
          placeholder="Any city"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="minPrice" className="text-xs text-gray-500">
          Min price
        </label>
        <input
          id="minPrice"
          name="minPrice"
          type="number"
          defaultValue={defaultValues.minPrice}
          placeholder="0"
          className="w-28 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="maxPrice" className="text-xs text-gray-500">
          Max price
        </label>
        <input
          id="maxPrice"
          name="maxPrice"
          type="number"
          defaultValue={defaultValues.maxPrice}
          placeholder="Any"
          className="w-28 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="bedrooms" className="text-xs text-gray-500">
          Min bedrooms
        </label>
        <input
          id="bedrooms"
          name="bedrooms"
          type="number"
          defaultValue={defaultValues.bedrooms}
          placeholder="Any"
          className="w-24 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
      </div>
      <button
        type="submit"
        className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
      >
        Search
      </button>
    </form>
  );
}
