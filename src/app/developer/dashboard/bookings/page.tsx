import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getBookingsForDeveloper } from "@/lib/data/bookings";
import { confirmBooking } from "@/lib/actions/bookings";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export default async function DeveloperBookingsPage() {
  const user = await requireRole("DEVELOPER");
  const bookings = await getBookingsForDeveloper(user.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Bookings</h1>
        <p className="text-gray-600">Deals closed on your linked properties.</p>
      </div>

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
                  {booking.bookingNumber && (
                    <p className="text-xs text-gray-400">#{booking.bookingNumber}</p>
                  )}
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
                        className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
                      >
                        Confirm booking
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
