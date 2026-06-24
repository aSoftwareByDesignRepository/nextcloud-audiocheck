(function () {
	'use strict';

	/** Matches server PlayQueueService::MAX_ITEMS. */
	const MAX_QUEUE_ITEMS = 2000;

	function finalizeQueue(snapshot) {
		if (snapshot.fileIds.length <= MAX_QUEUE_ITEMS) {
			return snapshot;
		}
		return {
			fileIds: snapshot.fileIds.slice(0, MAX_QUEUE_ITEMS),
			currentIndex: Math.min(snapshot.currentIndex, MAX_QUEUE_ITEMS - 1),
			truncated: true,
		};
	}

	function queueAddTracks(existingFileIds, currentIndex, toAdd) {
		if (!toAdd.length) {
			return finalizeQueue({ fileIds: existingFileIds.slice(), currentIndex });
		}
		const merged = existingFileIds.slice();
		let added = false;
		toAdd.forEach((fileId) => {
			if (!merged.includes(fileId)) {
				merged.push(fileId);
				added = true;
			}
		});
		if (!added) {
			return finalizeQueue({ fileIds: merged, currentIndex });
		}
		return finalizeQueue({
			fileIds: merged,
			currentIndex: existingFileIds.length === 0 ? 0 : currentIndex,
		});
	}

	function queuePlayNext(existingFileIds, currentIndex, toInsert) {
		if (!toInsert.length) {
			return finalizeQueue({ fileIds: existingFileIds.slice(), currentIndex });
		}
		if (existingFileIds.length === 0) {
			return finalizeQueue({ fileIds: toInsert.slice(), currentIndex: 0 });
		}
		const insertAt = Math.min(currentIndex + 1, existingFileIds.length);
		return finalizeQueue({
			fileIds: existingFileIds.slice(0, insertAt).concat(toInsert, existingFileIds.slice(insertAt)),
			currentIndex,
		});
	}

	window.AudioCheckQueueMerge = {
		MAX_QUEUE_ITEMS,
		queueAddTracks,
		queuePlayNext,
	};
})();
