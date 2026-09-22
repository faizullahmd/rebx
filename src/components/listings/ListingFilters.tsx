"use client";

import { useState } from "react";
import type { TransactionType, PropertyCategory, PropertyType } from "@prisma/client";
import {
  TRANSACTION_TYPES,
  TRANSACTION_LABELS,
  CATEGORY_LABELS,
  PROPERTY_TYPE_LABELS,
  categoriesFor,
  typesFor,
} from "@/lib/property-taxonomy";

export function ListingFilters({
  defaultValues,
}: {
  defaultValues: {
    city?: string;
    minPrice?: string;
    maxPrice?: string;
    bedrooms?: string;
    transactionType?: string;
    propertyCategory?: string;
    propertyType?: string;
  };
}) {
  const [transactionType, setTransactionType] = useState<TransactionType | "">(
    (defaultValues.transactionType as TransactionType) ?? ""
  );
  const [propertyCategory, setPropertyCategory] = useState<PropertyCategory | "">(
    (defaultValues.propertyCategory as PropertyCategory) ?? ""
  );
  const [propertyType, setPropertyType] = useState<PropertyType | "">(
    (defaultValues.propertyType as PropertyType) ?? ""
  );

  const availableCategories = transactionType ? categoriesFor(transactionType) : [];
  const availableTypes = transactionType ? typesFor(transactionType, propertyCategory) : [];

  function handleTransactionTypeChange(value: TransactionType | "") {
    setTransactionType(value);
    const nextCategories = value ? categoriesFor(value) : [];
    if (propertyCategory && !nextCategories.includes(propertyCategory)) {
      setPropertyCategory("");
      setPropertyType("");
    }
  }

  function handleCategoryChange(value: PropertyCategory | "") {
    setPropertyCategory(value);
    const nextTypes = transactionType ? typesFor(transactionType, value) : [];
    if (propertyType && !nextTypes.includes(propertyType)) {
      setPropertyType("");
    }
  }

  return (
    <form className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 p-4" action="/listings">
      <div className="flex flex-col gap-1">
        <label htmlFor="transactionType" className="text-xs text-gray-500">
          Transaction
        </label>
        <select
          id="transactionType"
          name="transactionType"
          value={transactionType}
          onChange={(e) => handleTransactionTypeChange(e.target.value as TransactionType | "")}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="">Any</option>
          {TRANSACTION_TYPES.map((value) => (
            <option key={value} value={value}>
              {TRANSACTION_LABELS[value]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="propertyCategory" className="text-xs text-gray-500">
          Category
        </label>
        <select
          id="propertyCategory"
          name="propertyCategory"
          value={propertyCategory}
          onChange={(e) => handleCategoryChange(e.target.value as PropertyCategory | "")}
          disabled={!transactionType}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:bg-gray-100"
        >
          <option value="">Any</option>
          {availableCategories.map((value) => (
            <option key={value} value={value}>
              {CATEGORY_LABELS[value]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="propertyType" className="text-xs text-gray-500">
          Type
        </label>
        <select
          id="propertyType"
          name="propertyType"
          value={propertyType}
          onChange={(e) => setPropertyType(e.target.value as PropertyType | "")}
          disabled={!propertyCategory}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:bg-gray-100"
        >
          <option value="">Any</option>
          {availableTypes.map((value) => (
            <option key={value} value={value}>
              {PROPERTY_TYPE_LABELS[value]}
            </option>
          ))}
        </select>
      </div>
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
