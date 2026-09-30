"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "@/components/ui/Avatar";

interface Review {
  id: string;
  name: string;
  role: string;
  rating: number;
  date: string;
  comment: string;
}

const SAMPLE_REVIEWS: Review[] = [
  {
    id: "r1",
    name: "Sarah Jenkins",
    role: "Verified Buyer",
    rating: 5,
    date: "2 weeks ago",
    comment:
      "Exceptionally prompt and professional! Answered every question about the HOA and tax records, and made scheduling viewings seamless.",
  },
  {
    id: "r2",
    name: "Michael Chen",
    role: "Property Investor",
    rating: 5,
    date: "1 month ago",
    comment:
      "Deep knowledge of the local neighborhood and market valuations. Negotiated terms fairly and saved us immense time.",
  },
  {
    id: "r3",
    name: "Emily Rodriguez",
    role: "First-time Buyer",
    rating: 5,
    date: "2 months ago",
    comment:
      "Patient, attentive, and incredibly helpful throughout the entire inspection and offer process. Couldn't have asked for a better agent!",
  },
];

export function BrokerCard({
  agentName,
  agentPhone,
}: {
  agentName: string;
  agentPhone: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [showReviewsModal, setShowReviewsModal] = useState(false);
  const [showWriteReview, setShowWriteReview] = useState(false);
  const [userRating, setUserRating] = useState(5);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (showReviewsModal) {
      document.body.style.overflow = "hidden";
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setShowReviewsModal(false);
          setShowWriteReview(false);
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => {
        document.body.style.overflow = "";
        window.removeEventListener("keydown", handleKeyDown);
      };
    } else {
      document.body.style.overflow = "";
    }
  }, [showReviewsModal]);

  return (
    <>
      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3.5 text-sm shadow-2xs">
        {/* Broker identity */}
        <div className="flex items-center gap-3">
          <Avatar name={agentName} />
          <div>
            <p className="font-semibold text-gray-900">{agentName}</p>
            <p className="text-xs text-gray-500">Listing agent</p>
            <a
              href={`tel:${agentPhone}`}
              className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-gray-700 transition hover:text-gray-900"
            >
              <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              <span>{agentPhone}</span>
            </a>
          </div>
        </div>

        {/* Ratings and Reviews Box */}
        <div className="rounded-xl border border-amber-200/60 bg-[#fffdf7] p-3 shadow-2xs">
          {/* Top row: 4.9, stars, count, badge */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-gray-900 leading-none">4.9</span>
              <div className="flex items-center text-amber-500">
                {[...Array(5)].map((_, i) => (
                  <svg key={i} className="h-4 w-4 fill-current" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setShowReviewsModal(true)}
                className="text-xs font-medium text-gray-500 underline hover:text-gray-900 cursor-pointer"
              >
                (28 reviews)
              </button>
            </div>

            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800">
              Verified Agent
            </span>
          </div>

          {/* Response metrics */}
          <div className="mt-2.5 flex items-center gap-4 text-xs text-gray-600">
            <span className="flex items-center gap-1.5 font-medium text-gray-700">
              <span className="text-emerald-600 font-bold">✓</span> 100% response rate
            </span>
            <span className="flex items-center gap-1.5 font-medium text-gray-700">
              <span className="text-amber-500 font-bold">⚡</span> &lt; 15 min avg. response
            </span>
          </div>

          {/* Review card quote */}
          <div className="mt-2.5 rounded-lg border border-amber-200/70 bg-white p-3 shadow-2xs">
            <p className="text-xs text-gray-700 italic leading-relaxed">
              &ldquo;Exceptionally prompt and professional! Answered every question about the HOA and ta...&rdquo;
            </p>
            <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
              <span className="font-semibold text-gray-800">— Sarah Jenkins (Verified Buyer)</span>
              <span>2 weeks ago</span>
            </div>
          </div>

          {/* Footer action links */}
          <div className="mt-3 flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => setShowReviewsModal(true)}
              className="font-semibold text-blue-600 hover:text-blue-800 transition cursor-pointer"
            >
              Read all 28 reviews &rarr;
            </button>
            <button
              type="button"
              onClick={() => {
                setShowWriteReview(true);
                setShowReviewsModal(true);
              }}
              className="font-medium text-gray-500 hover:text-gray-900 transition cursor-pointer"
            >
              Write a review
            </button>
          </div>
        </div>
      </div>

      {/* Ratings & Reviews Modal (Rendered in document.body via Portal to ensure absolute center and above sticky header) */}
      {mounted &&
        showReviewsModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-xs overflow-y-auto"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowReviewsModal(false);
                setShowWriteReview(false);
              }
            }}
          >
            <div
              className="relative my-auto w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl max-h-[85vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between border-b border-gray-100 pb-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {agentName}&apos;s Ratings &amp; Reviews
                  </h3>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="flex items-center text-amber-500">
                      {[...Array(5)].map((_, i) => (
                        <svg key={i} className="h-4 w-4 fill-current" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                      ))}
                    </div>
                    <span className="text-sm font-bold text-gray-900">4.9</span>
                    <span className="text-xs text-gray-500">(28 verified reviews)</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowReviewsModal(false);
                    setShowWriteReview(false);
                  }}
                  className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition cursor-pointer text-xl leading-none"
                  aria-label="Close dialog"
                >
                  &times;
                </button>
              </div>

              {/* Performance breakdown */}
              <div className="grid grid-cols-3 gap-2 my-4 rounded-xl bg-gray-50 p-3 text-center text-xs">
                <div>
                  <p className="font-semibold text-gray-900">5.0 ★</p>
                  <p className="text-[11px] text-gray-500">Communication</p>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">4.9 ★</p>
                  <p className="text-[11px] text-gray-500">Local Knowledge</p>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">4.8 ★</p>
                  <p className="text-[11px] text-gray-500">Negotiation</p>
                </div>
              </div>

              {/* Write a review form */}
              {showWriteReview ? (
                <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Leave a Client Review</h4>
                  {reviewSubmitted ? (
                    <p className="text-xs text-emerald-700 bg-emerald-50 p-2.5 rounded-lg font-medium">
                      ✓ Thank you! Your review has been submitted for verification.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-600">Your Rating:</span>
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              type="button"
                              onClick={() => setUserRating(star)}
                              className="cursor-pointer text-amber-500 hover:scale-110 transition"
                            >
                              <svg
                                className={`h-5 w-5 ${star <= userRating ? "fill-current" : "stroke-current fill-none"}`}
                                viewBox="0 0 20 20"
                              >
                                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                              </svg>
                            </button>
                          ))}
                        </div>
                      </div>
                      <textarea
                        rows={3}
                        placeholder="Share your experience working with this agent..."
                        className="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-xs focus:border-gray-900 focus:outline-none"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setShowWriteReview(false)}
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 transition"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => setReviewSubmitted(true)}
                          className="rounded-lg bg-gray-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-gray-800 transition"
                        >
                          Submit Review
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex justify-between items-center mb-3">
                  <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Verified Client Reviews
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowWriteReview(true)}
                    className="text-xs font-medium text-blue-600 hover:text-blue-800 cursor-pointer transition"
                  >
                    + Write a review
                  </button>
                </div>
              )}

              {/* List of sample reviews */}
              <div className="flex flex-col gap-3">
                {SAMPLE_REVIEWS.map((rev) => (
                  <div key={rev.id} className="rounded-xl border border-gray-100 bg-gray-50/50 p-3.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-gray-900">{rev.name}</p>
                        <p className="text-[10px] text-gray-500">{rev.role}</p>
                      </div>
                      <div className="flex items-center text-amber-500">
                        {[...Array(rev.rating)].map((_, i) => (
                          <svg key={i} className="h-3.5 w-3.5 fill-current" viewBox="0 0 20 20">
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                          </svg>
                        ))}
                        <span className="ml-1.5 text-[11px] text-gray-400">{rev.date}</span>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-gray-700 leading-relaxed">&ldquo;{rev.comment}&rdquo;</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 border-t border-gray-100 pt-3 text-right">
                <button
                  type="button"
                  onClick={() => {
                    setShowReviewsModal(false);
                    setShowWriteReview(false);
                  }}
                  className="rounded-lg bg-gray-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-gray-800 cursor-pointer transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
