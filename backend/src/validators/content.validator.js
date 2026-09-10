const Joi = require("joi");

const uuid = Joi.string().uuid();

const postBase = {
  type: Joi.string().valid("BLOG", "NEWS"),
  title: Joi.string().min(2).max(255),
  slug: Joi.string().max(280).allow("", null),
  excerpt: Joi.string().allow("", null),
  coverImageUrl: Joi.string().max(500).allow("", null),
  contentHtml: Joi.string().allow("", null),
  status: Joi.string().valid("DRAFT", "PUBLISHED", "ARCHIVED"),
  publishedAt: Joi.date().allow(null),
  authorName: Joi.string().max(150).allow("", null),
  authorRole: Joi.string().max(150).allow("", null),
  authorAvatarUrl: Joi.string().max(500).allow("", null),
  featured: Joi.boolean(),
  categoryIds: Joi.array().items(uuid),
};

exports.createPost = Joi.object({
  ...postBase,
  type: postBase.type.required(),
  title: postBase.title.required(),
});

exports.updatePost = Joi.object({ ...postBase }).min(1);

exports.createCategory = Joi.object({
  name: Joi.string().min(1).max(120).required(),
  slug: Joi.string().max(140).allow("", null),
  description: Joi.string().allow("", null),
});

exports.updateCategory = Joi.object({
  name: Joi.string().min(1).max(120),
  slug: Joi.string().max(140),
  description: Joi.string().allow("", null),
}).min(1);
