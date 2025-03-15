import {censorText, preprocessWordLists, WordReplacementType} from 'deep-profanity-filter';

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

export function FilterMessage(message) {
    message = censorText(message, wordFilter, {
        replacementType: WordReplacementType.RepeatCharacter,
        replacementRepeatCharacter: '*',
    });
    return (message);
}