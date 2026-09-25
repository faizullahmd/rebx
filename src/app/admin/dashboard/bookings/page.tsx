import Link from "next/link";
import { getAllBookingsAdmin } from "@/lib/data/bookings";
import { confirmBooking } from "@/lib/actions/bookings";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export default async function AdminBookingsPage() {
  const bookings = await getAllBookingsAdmin();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">All bookings</h1>
      {bookings.length === 0 ? (
        <p className="text-sm text-gray-500">No bookings yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th className="py-2 font-medium">Listing</th>
              <th className="py-2 font-medium">Agent</th>
              <th className="py-2 font-medium">Sale amount</th>
              <th className="py-2 font-medium">Booking date</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {bookings.map((booking) => (
              <tr key={booking.id} className="border-b border-gray-100">
                <td className="py-3">
                  <Link
                    href={`/listings/${booking.deal.listing.slug}`}
                    className="hover:underline"
                    target="_blank"
                  >
                    {booking.deal.listing.title}
                  </Link>
                </td>
                <td className="py-3 text-gray-600">{booking.deal.agent.name}</td>
                <td className="py-3 text-gray-600">
                  {currencyFormatter.format(Number(booking.saleAmount))}
                </td>
                <td className="py-3 text-gray-600">{dateFormatter.format(booking.bookingDate)}</td>
                <td className="py-3">
                  {booking.status === "CONFIRMED" ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      Confirmed
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      Pending
                    </span>
                  )}
                </td>
                <td className="py-3 text-right">
                  {booking.status === "PENDING_CONFIRMATION" && (
                    <form action={confirmBooking.bind(null, booking.id)}>
                      <button
                        type="submit"
                        className="rounded-md border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
                      >
                        Confirm
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
