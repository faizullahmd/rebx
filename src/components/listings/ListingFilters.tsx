"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
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
    q?: string;
    tag?: string;
  };
}) {
  const inferredCategory: PropertyCategory | "" =
    (defaultValues.propertyCategory as PropertyCategory) ||
    (defaultValues.propertyType === "APARTMENT" || defaultValues.propertyType === "VILLA"
      ? "RESIDENTIAL"
      : "");
  const inferredTransaction: TransactionType | "" =
    (defaultValues.transactionType as TransactionType) ||
    (defaultValues.propertyType ? "FOR_SALE" : "");

  const [transactionType, setTransactionType] = useState<TransactionType | "">(
    inferredTransaction
  );
  const [propertyCategory, setPropertyCategory] = useState<PropertyCategory | "">(
    inferredCategory
  );
  const [propertyType, setPropertyType] = useState<PropertyType | "">(
    (defaultValues.propertyType as PropertyType) ?? ""
  );

  useEffect(() => {
    const nextTransaction =
      (defaultValues.transactionType as TransactionType) ||
      (defaultValues.propertyType ? "FOR_SALE" : "");
    const nextCategory =
      (defaultValues.propertyCategory as PropertyCategory) ||
      (defaultValues.propertyType === "APARTMENT" || defaultValues.propertyType === "VILLA"
        ? "RESIDENTIAL"
        : "");
    const nextType = (defaultValues.propertyType as PropertyType) ?? "";

    setTransactionType(nextTransaction);
    setPropertyCategory(nextCategory);
    setPropertyType(nextType);
  }, [defaultValues.transactionType, defaultValues.propertyCategory, defaultValues.propertyType]);

  const availableCategories = transactionType ? categoriesFor(transactionType) : [];
  const availableTypes = transactionType ? typesFor(transactionType, propertyCategory) : [];
  const hasActiveFilters = Object.values(defaultValues).some((value) => !!value);

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
      {defaultValues.q && <input type="hidden" name="q" value={defaultValues.q} />}
      {defaultValues.tag && <input type="hidden" name="tag" value={defaultValues.tag} />}
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
          disabled={!transactionType && !propertyCategory}
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
          disabled={!propertyCategory && !propertyType}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:bg-gray-100"
        >
          <option value="">Any</option>
          {availableTypes.map((value) => (
            <option key={value} value={value}>
              {PROPERTY_TYPE_LABELS[value]}
            </option>
          ))}
          {propertyType && !availableTypes.includes(propertyType as PropertyType) && (
            <option value={propertyType}>
              {PROPERTY_TYPE_LABELS[propertyType as PropertyType] || propertyType}
            </option>
          )}
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
          Min price (₹)
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
          Max price (₹)
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
      {hasActiveFilters && (
        <Link
          href="/listings"
          className="text-sm font-medium text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
        >
          Clear filters
        </Link>
      )}
    </form>
  );
}
