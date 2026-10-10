import {
  getCharacterDisplayName,
  getSocialAccountProvider,
} from "./formatters/accounts.js";
import { getStringValue } from "./formatters/values.js";
import type { NotificationCopy, NotificationDeliveryData } from "./types.js";

type NotificationCopyFormatter = (
  data: NotificationDeliveryData,
  copy: NotificationCopy,
) => NotificationCopy;

const formatterByType: Record<string, NotificationCopyFormatter> = {
  "characters.added": (data, copy) => {
    const character = getCharacterDisplayName(data);
    const method = getStringValue(data.notification.params.method);

    if (!character) {
      return copy;
    }

    return {
      ...copy,
      description: method
        ? `${character} was added to your FullParty account via ${method}.`
        : `${character} was added to your FullParty account.`,
      title: "Character added",
    };
  },
  "characters.unclaimed": (data, copy) => {
    const character = getCharacterDisplayName(data);

    if (!character) {
      return copy;
    }

    return {
      ...copy,
      description: `${character} was unclaimed from your FullParty account.`,
      title: "Character unclaimed",
    };
  },
  "user.social_account.linked": (data, copy) => {
    const provider = getSocialAccountProvider(data);

    if (!provider) {
      return copy;
    }

    return {
      ...copy,
      description: `${provider} was linked to your FullParty account.`,
      title: `${provider} account linked`,
    };
  },
  "user.social_account.unlinked": (data, copy) => {
    const provider = getSocialAccountProvider(data);

    if (!provider) {
      return copy;
    }

    return {
      ...copy,
      description: `${provider} was removed from your FullParty account.`,
      title: `${provider} account removed`,
    };
  },
};

export function formatNotificationCopy(
  data: NotificationDeliveryData,
  copy: NotificationCopy,
): NotificationCopy {
  return formatterByType[data.notification.type]?.(data, copy) ?? copy;
}
