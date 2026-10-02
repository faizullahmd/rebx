import { prisma } from "../src/lib/prisma";
import { parseVideoUrl } from "../src/lib/video";

export const DUMMY_VIDEO_DATA = [
  {
    title: "Inside Dakota Johnson's Serene Hollywood Home",
    url: "https://www.youtube.com/watch?v=AwhBTrzzqeg",
  },
  {
    title: "Inside Ellen Pompeo's Midcentury Malibu Beach House",
    url: "https://www.youtube.com/watch?v=fsYZye1Ykao",
  },
  {
    title: "Inside Gwyneth Paltrow's Tranquil Family Home",
    url: "https://www.youtube.com/watch?v=haK2TnmVoT0",
  },
  {
    title: "Inside Serena Williams' Modern Florida Estate",
    url: "https://www.youtube.com/watch?v=-TeeIEh2IE8",
  },
  {
    title: "Inside Lenny Kravitz's Brazilian Villa Compound",
    url: "https://www.youtube.com/watch?v=FlsKjWqu82k",
  },
  {
    title: "Inside Hilary Duff's Vibrant Family Home",
    url: "https://www.youtube.com/watch?v=5vNoHwgoIjw",
  },
];

export const DUMMY_VIDEO_URLS: string[] = DUMMY_VIDEO_DATA.map((d) => d.url);

async function main() {
  const isClear = process.argv.includes("--clear") || process.argv.includes("-c");

  if (isClear) {
    console.log("Clearing dummy gallery videos...");
    const dummyVideos = await prisma.video.findMany({
      where: {
        url: { in: DUMMY_VIDEO_URLS },
      },
    });

    const dummyVideoIds = dummyVideos.map((v) => v.id);

    if (dummyVideoIds.length > 0) {
      // Disconnect listings
      const updatedListings = await prisma.listing.updateMany({
        where: {
          videoId: { in: dummyVideoIds },
        },
        data: {
          videoId: null,
          videoUrl: null,
        },
      });
      console.log(`Unlinked dummy videos from ${updatedListings.count} listings.`);

      // Delete the dummy videos
      const deleted = await prisma.video.deleteMany({
        where: { id: { in: dummyVideoIds } },
      });
      console.log(`Successfully deleted ${deleted.count} dummy video records.`);
    } else {
      console.log("No dummy videos found to clear.");
    }
    return;
  }

  console.log("1. Migrating any existing listings with videoUrl into Video table...");
  const listingsWithUrl = await prisma.listing.findMany({
    where: {
      videoUrl: { not: null },
    },
    select: {
      id: true,
      title: true,
      videoUrl: true,
      videoId: true,
      agentId: true,
      developerId: true,
    },
  });

  let migratedCount = 0;
  for (const listing of listingsWithUrl) {
    if (!listing.videoUrl) continue;
    const parsed = parseVideoUrl(listing.videoUrl);
    if (!parsed) continue;

    const ownerId = listing.developerId || listing.agentId;

    const videoRecord = await prisma.video.upsert({
      where: {
        provider_videoId: {
          provider: parsed.provider,
          videoId: parsed.videoId,
        },
      },
      update: {
        thumbnailUrl: parsed.thumbnailUrl,
        url: listing.videoUrl,
      },
      create: {
        title: `${listing.title} Tour`,
        url: listing.videoUrl,
        provider: parsed.provider,
        videoId: parsed.videoId,
        thumbnailUrl: parsed.thumbnailUrl,
        createdById: ownerId,
      },
    });

    if (listing.videoId !== videoRecord.id) {
      await prisma.listing.update({
        where: { id: listing.id },
        data: { videoId: videoRecord.id },
      });
      migratedCount++;
    }
  }
  console.log(`Migrated / synchronized ${migratedCount} listings with standalone Video records.`);

  console.log("2. Seeding dummy Video records...");
  const defaultUser = await prisma.user.findFirst({
    where: {
      role: { in: ["DEVELOPER", "AGENT", "ADMIN"] },
    },
    select: { id: true },
  });

  if (!defaultUser) {
    console.log("No agent or developer user found in database to associate dummy videos with.");
    return;
  }

  const createdDummyVideos = [];
  for (const item of DUMMY_VIDEO_DATA) {
    const parsed = parseVideoUrl(item.url);
    if (!parsed) continue;

    const video = await prisma.video.upsert({
      where: {
        provider_videoId: {
          provider: parsed.provider,
          videoId: parsed.videoId,
        },
      },
      update: {
        title: item.title,
        thumbnailUrl: parsed.thumbnailUrl,
        url: item.url,
      },
      create: {
        title: item.title,
        url: item.url,
        provider: parsed.provider,
        videoId: parsed.videoId,
        thumbnailUrl: parsed.thumbnailUrl,
        createdById: defaultUser.id,
      },
    });
    createdDummyVideos.push(video);
  }
  console.log(`Ensured ${createdDummyVideos.length} dummy Video records exist in the gallery.`);

  console.log("3. Attaching dummy videos to listings that do not have a video...");
  const targetListings = await prisma.listing.findMany({
    where: {
      videoId: null,
      status: "ACTIVE",
    },
    take: createdDummyVideos.length,
    orderBy: { id: "asc" },
  });

  let attachedCount = 0;
  for (let i = 0; i < targetListings.length && i < createdDummyVideos.length; i++) {
    const listing = targetListings[i];
    const video = createdDummyVideos[i];

    await prisma.listing.update({
      where: { id: listing.id },
      data: {
        videoId: video.id,
        videoUrl: video.url,
      },
    });
    attachedCount++;
    console.log(`Attached video "${video.title}" to listing #${listing.id} ("${listing.title}")`);
  }

  console.log(`Done! Attached videos to ${attachedCount} active listings.`);
}

main()
  .catch((e) => {
    console.error("Error during video seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
