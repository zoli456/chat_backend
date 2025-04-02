import {censorText, preprocessWordLists, WordReplacementType} from 'deep-profanity-filter';
import sanitizeHtml  from "sanitize-html";

const badwords = [
    "bazd*", "hitler", "cigany*", "*geci*",
    "*fasz*", "f4sz*", "*pina*", "*pinák*",
    "p1na", "p1nák", "*kurva*", "*kurvák*",
    "szar", "sz4r*", "szaro*", "szari*",
    "szarn*", "szart*", "szarna*", "szaro*",
    "szars*", "kutyaszar*", "macsakaszar*", "kiszar*",
    "beszar*", "összeszar*", "lószar*", "szétszar*",
    "leszar*", "beleszar*", "zsidó*", "*bitch*",
    "*dick*", "*cunt*", "*fuck*", "*nigger*",
    "*niger*", "*pussy*", "*pussies", "*whore*",
    "*shit*",
];
let whitelist = [];
let wordFilter = preprocessWordLists(badwords, whitelist);

const FilterProfanity = (message) => {
    message = censorText(message, wordFilter, {
        replacementType: WordReplacementType.RepeatCharacter,
        replacementRepeatCharacter: '*',
    });
    return (message);
}

const sanitizeContent = (value) => {
    return sanitizeHtml(value);
};
const validateAndSanitizeContent = (html) => {
    // First check for disallowed tags without modifying the content
    const disallowedTags = ['script', 'style', 'link', 'meta', 'object', 'embed', 'applet', 'frame', 'frameset'];
    const disallowedTagRegex = new RegExp(`<(${disallowedTags.join('|')})(\\s|>|\\/)`, 'i');
    const hasDisallowed = disallowedTagRegex.test(html);

    // Get text length without any tags
    const textWithoutTags = sanitizeContent(html);
    const textLength = textWithoutTags.length;

    // Perform actual sanitization
    const sanitized = sanitizeHtml(html, {
        allowedTags: [
            "b", "i", "em", "strong", "u", "a", "ul", "ol", "li", "p", "br", "s",
            "blockquote", "code", "pre", "h1", "h2", "h3", "h4", "h5", "h6",
            "img", "iframe"
        ],
        allowedAttributes: {
            "a": ["href", "title", "target"],
            "img": ["src", "alt", "title", "width", "height"],
            "iframe": ["src", "width", "height", "frameborder", "allow", "allowfullscreen"]
        },
        allowedSchemes: ["http", "https"],
        allowedSchemesByTag: {
            "a": ["http", "https", "mailto"],
            "img": ["http", "https", "data"],
            "iframe": ["https"]
        },
        selfClosing: ["br", "hr", "img"],
        enforceHtmlBoundary: true,
        allowedIframeHostnames: [
            "www.youtube.com", "youtube.com", "www.youtu.be", "youtu.be",
            "player.vimeo.com", "vimeo.com",
            "www.twitch.tv", "player.twitch.tv",
            "platform.twitter.com", "twitter.com"
        ]
    });

    return {
        sanitized,
        hasDisallowedTags: hasDisallowed,
        textLength,
        isEmpty: textLength === 0
    };
};

export { FilterProfanity, validateAndSanitizeContent, sanitizeContent };
