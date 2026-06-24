(function () {
	'use strict';

	const DEFAULT_PLAYBACK_POLICY = { mode: 'resume', resumeAnchorIndex: null };

	function createQueuePlaybackPolicy(options) {
		const fileCount = options.fileCount;
		const explicitMode = options.explicitMode;
		let resumeAnchorIndex = options.resumeAnchorIndex != null ? options.resumeAnchorIndex : null;
		if (fileCount <= 1) {
			return { mode: 'resume', resumeAnchorIndex: null };
		}
		if (resumeAnchorIndex !== null) {
			return { mode: 'sequential', resumeAnchorIndex };
		}
		if (explicitMode === 'resume') {
			return { mode: 'resume', resumeAnchorIndex: null };
		}
		return { mode: 'sequential', resumeAnchorIndex: null };
	}

	function effectiveStartMode(policy, currentIndex) {
		if (policy.resumeAnchorIndex !== null && policy.resumeAnchorIndex === currentIndex) {
			return 'resume';
		}
		return policy.mode;
	}

	function resolvePlaybackPolicyForQueueStart(options) {
		let resumeAnchorIndex = options.resumeAnchorIndex != null ? options.resumeAnchorIndex : null;
		let explicitMode = options.explicitMode;
		if (explicitMode === 'resume' && options.fileCount > 1 && resumeAnchorIndex === null) {
			resumeAnchorIndex = options.currentIndex;
			explicitMode = undefined;
		}
		return createQueuePlaybackPolicy({
			fileCount: options.fileCount,
			explicitMode,
			resumeAnchorIndex,
		});
	}

	function policyForManualQueueChange(fileCount) {
		if (fileCount <= 1) {
			return DEFAULT_PLAYBACK_POLICY;
		}
		return { mode: 'sequential', resumeAnchorIndex: null };
	}

	function policyAfterQueueEdit(prevPolicy, prevFileIds, nextFileIds) {
		if (nextFileIds.length <= 1) {
			return DEFAULT_PLAYBACK_POLICY;
		}
		if (prevPolicy.mode === 'sequential' && prevPolicy.resumeAnchorIndex === null) {
			return prevPolicy;
		}
		if (prevPolicy.resumeAnchorIndex !== null) {
			const anchorId = prevFileIds[prevPolicy.resumeAnchorIndex];
			if (anchorId) {
				const nextAnchor = nextFileIds.indexOf(anchorId);
				if (nextAnchor >= 0) {
					return { mode: 'sequential', resumeAnchorIndex: nextAnchor };
				}
			}
		}
		return policyForManualQueueChange(nextFileIds.length);
	}

	window.AudioCheckQueuePlaybackMode = {
		DEFAULT_PLAYBACK_POLICY,
		createQueuePlaybackPolicy,
		effectiveStartMode,
		resolvePlaybackPolicyForQueueStart,
		policyForManualQueueChange,
		policyAfterQueueEdit,
	};
})();
